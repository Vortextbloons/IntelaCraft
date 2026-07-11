import { refreshPiSessionProvider, type ChatTurn, type PlanStreamEvent } from "@intelacraft/pi-extension";
import type { AuditLog } from "../../audit.js";
import type { SessionStore } from "../../store.js";
import { appendHistory, planHistoryText, resolveHistory } from "../chat-history.js";
import {
  applyAgentVerificationPlan,
  applyPlanToTask,
  buildWorldContext,
} from "../inspection/materialize.js";
import { needProvider } from "../provider-store.js";
import { publicTask } from "../task-store.js";
import type { AgentContext, AgentTaskState } from "../types.js";
import { enqueuePendingReads, planWithValidationRetry } from "./planner.js";

export function scheduleAgentVerification(ctx: AgentContext, task: import("../types.js").AgentTask, sessions: SessionStore, audit: AuditLog) {
  if (task.agentVerificationStarted) return;
  task.agentVerificationStarted = true;
  task.state = "verifying";
  task.updatedAt = new Date().toISOString();
  audit.append({
    type: "task_lifecycle",
    taskId: task.id,
    state: task.state,
    phase: "agent_verification",
  });
  // Release the operation-event queue before Pi can call another live inspection tool.
  setTimeout(() => {
    void ctx.verifyAfterMutations(task.id, sessions, audit);
  }, 0);
}

export async function verifyAfterMutations(ctx: AgentContext, taskId: string, sessions: SessionStore, audit: AuditLog) {
  const task = ctx.tasks.get(taskId);
  if (!task || task.state === "cancelled" || task.state === "rejected") return;
  const session = ctx.pi.get(task.piSessionId);
  if (!session) {
    task.state = "partial";
    task.error = "Pi session missing for post-mutation verification";
    audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state, error: task.error });
    return;
  }
  try {
    const provider = needProvider(ctx, session.providerId);
    await refreshPiSessionProvider(session, provider, ctx.thinkingLevel);
    const history = ctx.chatHistory.get(session.id) ?? [];
    const plan = await planWithValidationRetry(
      ctx,
      session.id,
      `The approved mutations for this task have finished. Verify the actual world state now using live inspect_* tools. If the requested outcome is satisfied, submit a plan with no actions. If correction is needed, submit only the smallest corrective actions; they will require fresh approval.\nOriginal request: ${task.request}`,
      buildWorldContext(ctx, sessions),
      undefined,
      {
        thinkingLevel: ctx.thinkingLevel,
        mode: task.mode,
        adminCommandIds: Object.keys(ctx.config.adminCommands),
        history,
      },
      task,
      {
        bdsSessionId: task.bdsSessionId!,
        actor: task.actor,
        permissionMode: task.permissionMode,
        sessions,
        audit,
      },
    );
    appendHistory(ctx, session.id, { role: "assistant", content: planHistoryText(plan) });
    applyAgentVerificationPlan(ctx, task, plan);
    task.error = undefined;
  } catch (error) {
    task.state = "partial";
    task.error = error instanceof Error ? error.message : "Post-mutation verification failed";
  }
  task.updatedAt = new Date().toISOString();
  audit.append({
    type: "task_lifecycle",
    taskId: task.id,
    state: task.state,
    phase: "agent_verification_complete",
    error: task.error,
  });
}

/** After inspect wave completes, re-plan mutations with real world facts. */
export async function replanAfterInspection(
  ctx: AgentContext,
  taskId: string,
  sessions: SessionStore,
  audit: AuditLog,
  onEvent?: (event: PlanStreamEvent) => void,
) {
  const task = ctx.tasks.get(taskId);
  if (!task || !task.awaitingInspectReplan) return publicTask(task!);
  const s = ctx.pi.get(task.piSessionId);
  if (!s) {
    task.state = "failed";
    task.error = "Pi session missing for replan";
    return publicTask(task);
  }
  task.state = "planning";
  task.awaitingInspectReplan = false;
  audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state, phase: "replan" });
  try {
    const provider = needProvider(ctx, s.providerId);
    await refreshPiSessionProvider(s, provider, ctx.thinkingLevel);
    const world = buildWorldContext(ctx, sessions);
    const history = ctx.chatHistory.get(s.id) ?? [];
    const plan = await planWithValidationRetry(
      ctx,
      s.id,
      `Inspection finished for the original request. Propose the final mutation plan now (prefer empty inspection if facts are known).\nOriginal request: ${task.request}`,
      world,
      undefined,
      {
        thinkingLevel: ctx.thinkingLevel,
        mode: task.mode,
        adminCommandIds: Object.keys(ctx.config.adminCommands),
        history,
        onEvent,
      },
      task,
      {
        bdsSessionId: task.bdsSessionId!,
        actor: task.actor,
        permissionMode: task.permissionMode,
        sessions,
        audit,
      },
    );
    // Keep original request on the task; apply refined plan.
    applyPlanToTask(ctx, task, plan, {
      bdsSessionId: task.bdsSessionId!,
      actor: task.actor,
      permissionMode: task.permissionMode,
    });
    // If replan still wants inspect-only deferral, just enqueue reads again.
    const nextState = task.state as AgentTaskState;
    if (nextState === "inspecting" || (nextState === "planned" && (task.pendingReads?.length ?? 0) > 0)) {
      enqueuePendingReads(ctx, task, sessions, audit);
    }
    appendHistory(ctx, s.id, {
      role: "assistant",
      content: planHistoryText(plan),
    });
  } catch (e) {
    task.state = "failed";
    task.error = e instanceof Error ? e.message : "Replan failed";
  }
  task.updatedAt = new Date().toISOString();
  audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
  return publicTask(task);
}

/** Edit-and-replan: reject current mutations and plan again with user notes. */
export async function editAndReplan(
  ctx: AgentContext,
  taskId: string,
  input: {
    notes: string;
    sessions: SessionStore;
    audit: AuditLog;
    history?: ChatTurn[];
    onEvent?: (event: PlanStreamEvent) => void;
  },
) {
  const task = ctx.tasks.get(taskId);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
  if (task.state !== "awaiting_approval" && task.state !== "planned" && task.state !== "inspecting") {
    throw Object.assign(new Error(`Task cannot be edited in state ${task.state}`), {
      code: "INVALID_STATE",
      status: 409,
    });
  }
  const s = ctx.pi.get(task.piSessionId);
  if (!s) throw new Error("Unknown Pi session");
  task.state = "planning";
  task.error = undefined;
  input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state, phase: "edit_replan" });
  const request = `${task.request}\n\nUser edit notes: ${input.notes}`;
  try {
    const provider = needProvider(ctx, s.providerId);
    await refreshPiSessionProvider(s, provider, ctx.thinkingLevel);
    const world = buildWorldContext(ctx, input.sessions);
    const history = resolveHistory(ctx, s.id, input.history);
    const plan = await planWithValidationRetry(
      ctx,
      s.id,
      request,
      world,
      undefined,
      {
        thinkingLevel: ctx.thinkingLevel,
        adminCommandIds: Object.keys(ctx.config.adminCommands),
        history,
        onEvent: input.onEvent,
      },
      task,
      {
        bdsSessionId: task.bdsSessionId!,
        actor: task.actor,
        permissionMode: task.permissionMode,
        sessions: input.sessions,
        audit: input.audit,
      },
    );
    task.request = request;
    applyPlanToTask(ctx, task, plan, {
      bdsSessionId: task.bdsSessionId!,
      actor: task.actor,
      permissionMode: task.permissionMode,
    });
    enqueuePendingReads(ctx, task, input.sessions, input.audit);
    appendHistory(ctx, s.id, { role: "user", content: input.notes });
    appendHistory(ctx, s.id, { role: "assistant", content: planHistoryText(plan) });
  } catch (e) {
    task.state = "failed";
    task.error = e instanceof Error ? e.message : "Edit replan failed";
  }
  task.updatedAt = new Date().toISOString();
  return publicTask(task);
}
