import { injectPiToolResult } from "@intelacraft/pi-extension";
import type { AuditLog } from "../../audit.js";
import type { SessionStore } from "../../store.js";
import { appendHistory } from "../chat-history.js";
import { resolveInspectionWaiter } from "../inspection/bridge.js";
import { updateWorldSnapshotFromCollision } from "../inspection/materialize.js";
import { materializeAction } from "../inspection/materialize.js";
import { createRepairOperations,verifyBuild } from "@intelacraft/construction";
import type { VoxelSnapshot } from "@intelacraft/shared-protocol";
import { enqueueNextCompiledPhase } from "./approve.js";
import { replanAfterInspection, scheduleAgentVerification } from "../planning/replan.js";
import { persistTasks } from "../task-store.js";
import type { AgentContext, AgentTask } from "../types.js";

export async function onOperationEvent(
  ctx: AgentContext,
  actionId: string,
  state: string,
  audit: AuditLog,
  detail?: {
    message?: string;
    result?: unknown;
    sessions?: SessionStore;
    toolName?: string;
  },
): Promise<void> {
  for (const task of ctx.tasks.values()) {
    if (!task.enqueuedActionIds?.includes(actionId)) continue;
    const previous = ctx.operationEventQueues.get(task.id) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => processOperationEvent(ctx, task, actionId, state, audit, detail));
    ctx.operationEventQueues.set(task.id, current);
    try {
      await current;
    } finally {
      if (ctx.operationEventQueues.get(task.id) === current) {
        ctx.operationEventQueues.delete(task.id);
      }
    }
    return;
  }
}

async function processOperationEvent(
  ctx: AgentContext,
  task: AgentTask,
  actionId: string,
  state: string,
  audit: AuditLog,
  detail?: {
    message?: string;
    result?: unknown;
    sessions?: SessionStore;
    toolName?: string;
  },
): Promise<void> {
  if (task.state === "cancelled" || task.state === "rejected") return;

  resolveInspectionWaiter(ctx, actionId, state, detail);

  const terminal =
    state === "completed" ||
    state === "partially_completed" ||
    state === "failed" ||
    state === "cancelled";

  if (state === "running") {
    if (task.state !== "inspecting" && task.state !== "verifying") {
      task.state = "running";
    }
  }

  if (terminal) {
    const completed = new Set(task.completedActionIds ?? []);
    // BDS may retry delivery. A terminal action must affect history/state exactly once.
    if (completed.has(actionId)) return;
    completed.add(actionId);
    task.completedActionIds = [...completed];

    if (detail?.message || detail?.result !== undefined) {
      const tool =
        detail.toolName ??
        task.actionToolNames?.[actionId] ??
        task.proposedActions?.find((a) => a.actionId === actionId)?.toolName ??
        "tool";
      const resultText =
        detail.result !== undefined
          ? `${detail.message ?? "ok"}\n${JSON.stringify(detail.result).slice(0, 1500)}`
          : (detail.message ?? "ok");
      appendHistory(ctx, task.piSessionId, {
        role: "assistant",
        content: `[tool result ${tool}] ${resultText}`.slice(0, 4000),
      });
      await injectPiToolResult(task.piSessionId, tool, detail.message ?? "ok", detail.result);
      if (tool === "inspect.build_collision" && detail.result) {
        updateWorldSnapshotFromCollision(ctx, task, detail.result);
      }
      if(tool==="inspect.voxel_snapshot"&&detail.result)task.finalVoxelSnapshot=detail.result as VoxelSnapshot;
      if(tool==="inspect.voxel_snapshot"&&detail.result&&task.pendingCompiledBuild){try{task.buildVerification=verifyBuild(task.pendingCompiledBuild.expected,detail.result as VoxelSnapshot);if(task.buildVerification.completionPercent<100&&(task.repairPasses??0)<1){const repair=createRepairOperations(task.pendingCompiledBuild.expected,task.buildVerification);if(repair.length){task.proposedActions=repair.map(operation=>materializeAction(ctx,{toolName:operation.toolName,arguments:operation.arguments as unknown as Record<string,unknown>},{bdsSessionId:task.bdsSessionId!,actor:task.actor,permissionMode:task.permissionMode},false));task.compiledActionPhases=undefined;task.compiledPhaseCursor=undefined;task.compiledApprovedBy=undefined;task.mutationActionIds=[];task.repairPasses=(task.repairPasses??0)+1;task.state="awaiting_approval";task.error=`Build verification ${task.buildVerification.completionPercent}% complete; one bounded repair pass is awaiting approval.`;task.actionToolNames={...(task.actionToolNames??{}),...Object.fromEntries(task.proposedActions.map(a=>[a.actionId,a.toolName]))};}}}catch(error){task.state="partial";task.error=error instanceof Error?error.message:"Build verification failed";}}
    }

    if (state === "failed") {
      task.state = "failed";
      if(task.compiledActionPhases)task.error=`Required build phase '${task.compiledActionPhases[actionId]??"unknown"}' failed; dependent phases were not queued.`;
    } else if (state === "cancelled") {
      task.state = "cancelled";
    } else if (state === "partially_completed") {
      task.state = "partial";
    } else if (state === "completed") {
      const inspectIds = task.inspectActionIds ?? [];
      const mutationIds = task.mutationActionIds ?? [];
      const verifyIds = task.verifyActionIds ?? [];
      const done = (ids: string[]) =>
        ids.length > 0 && ids.every((id) => completed.has(id));

      if(task.compiledActionPhases?.[actionId]&&task.compiledPhaseCursor!==undefined&&detail?.sessions){const phase=task.pendingCompiledBuild?.phases[task.compiledPhaseCursor],phaseIds=phase?(task.proposedActions??[]).filter(a=>task.compiledActionPhases?.[a.actionId]===phase.id).map(a=>a.actionId):[];if(phaseIds.length&&phaseIds.every(id=>completed.has(id))){if(enqueueNextCompiledPhase(ctx,task,detail.sessions,audit)){task.state="running";}else if(task.pendingCompiledBuild){const action=materializeAction(ctx,{toolName:"inspect.voxel_snapshot",arguments:{dimension:task.pendingCompiledBuild.expected.dimension,region:task.pendingCompiledBuild.expected.bounds}},{bdsSessionId:task.bdsSessionId!,actor:task.actor,permissionMode:task.permissionMode},true),queued=detail.sessions.enqueue(action.sessionId,{...action,noApprovalReason:"verification_read"});if(!queued.ok){task.state="partial";task.error=queued.message;}else{task.enqueuedActionIds=[...(task.enqueuedActionIds??[]),action.actionId];task.verifyActionIds=[action.actionId];task.actionToolNames={...(task.actionToolNames??{}),[action.actionId]:action.toolName};task.state="verifying";audit.append({type:"action_enqueued",taskId:task.id,sessionId:action.sessionId,actionId:action.actionId,toolName:action.toolName,actor:action.actor,risk:action.risk,arguments:action.arguments,noApprovalReason:"verification_read"});}}}}

      if (task.awaitingInspectReplan && done(inspectIds) && detail?.sessions) {
        await replanAfterInspection(ctx, task.id, detail.sessions, audit);
      } else if (task.state === "inspecting" && done(inspectIds) && !task.awaitingInspectReplan) {
        const hasPendingMutations = (task.proposedActions ?? []).some((action) => action.risk !== "read");
        task.state = hasPendingMutations ? "awaiting_approval" : "completed";
      } else if (
        (task.state === "running" || mutationIds.length > 0) &&
        mutationIds.length > 0 &&
        !task.compiledActionPhases &&
        done(mutationIds)
      ) {
        if (detail?.sessions) scheduleAgentVerification(ctx, task, detail.sessions, audit);
        else task.state = "partial";
      } else if (task.state === "verifying" && done(verifyIds)) {
        task.state = task.buildVerification?.completionPercent===100 ? "completed" : "partial";if(task.state==="partial"&&!task.error)task.error=`Build verification ${task.buildVerification?.completionPercent??0}% complete`;
        if(task.state==="completed"&&ctx.builds&&task.pendingCompiledBuild&&!task.libraryBuildId){const storage=await ctx.builds.storage();if(storage.totalBytes<(ctx.config.buildLibraryLimitBytes??Infinity)){const entry=await ctx.builds.save({taskId:task.id,spec:task.pendingCompiledBuild.spec,expected:task.pendingCompiledBuild.expected,verification:task.buildVerification,final:task.finalVoxelSnapshot,tags:[task.pendingCompiledBuild.spec.type,task.pendingCompiledBuild.spec.style]});task.libraryBuildId=entry.id;audit.append({type:"task_lifecycle",taskId:task.id,state:task.state,phase:"build_library_auto_saved",buildId:entry.id});}}
      } else if (
        inspectIds.length > 0 &&
        done(inspectIds) &&
        mutationIds.length === 0 &&
        !task.awaitingInspectReplan &&
        task.state !== "awaiting_approval"
      ) {
        // Inspect-only task
        task.state = "completed";
      } else if (
        (task.enqueuedActionIds ?? []).every((id) => completed.has(id)) &&
        task.state !== "awaiting_approval" &&
        task.state !== "inspecting" &&
        task.state !== "verifying"
      ) {
        task.state = "completed";
      }
    }
  }

  task.updatedAt = new Date().toISOString();
  audit.append({
    type: "task_lifecycle",
    taskId: task.id,
    actionId,
    state: task.state,
    operationState: state,
  });
  persistTasks(ctx);
}
