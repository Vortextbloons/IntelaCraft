import { injectPiToolResult } from "@intelacraft/pi-extension";
import type { AuditLog } from "../../audit.js";
import type { SessionStore } from "../../store.js";
import { appendHistory } from "../chat-history.js";
import { resolveInspectionWaiter } from "../inspection/bridge.js";
import { updateWorldSnapshotFromCollision } from "../inspection/materialize.js";
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
    }

    if (state === "failed") {
      task.state = "failed";
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

      if (task.awaitingInspectReplan && done(inspectIds) && detail?.sessions) {
        await replanAfterInspection(ctx, task.id, detail.sessions, audit);
      } else if (task.state === "inspecting" && done(inspectIds) && !task.awaitingInspectReplan) {
        const hasPendingMutations = (task.proposedActions ?? []).some((action) => action.risk !== "read");
        task.state = hasPendingMutations ? "awaiting_approval" : "completed";
      } else if (
        (task.state === "running" || mutationIds.length > 0) &&
        mutationIds.length > 0 &&
        done(mutationIds)
      ) {
        if (detail?.sessions) scheduleAgentVerification(ctx, task, detail.sessions, audit);
        else task.state = "partial";
      } else if (task.state === "verifying" && done(verifyIds)) {
        task.state = "completed";
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
