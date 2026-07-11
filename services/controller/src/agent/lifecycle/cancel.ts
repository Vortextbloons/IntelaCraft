import { createActionRequest, newId } from "@intelacraft/shared-protocol";
import type { AuditLog } from "../../audit.js";
import type { SessionStore } from "../../store.js";
import { publicTask } from "../task-store.js";
import type { AgentContext } from "../types.js";

export function cancelTask(
  ctx: AgentContext,
  taskId: string,
  input: { cancelledBy: string; sessions: SessionStore; audit: AuditLog },
) {
  const task = ctx.tasks.get(taskId);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
  if (task.state === "completed" || task.state === "rejected" || task.state === "cancelled") {
    throw Object.assign(new Error(`Task already terminal (${task.state})`), {
      code: "INVALID_STATE",
      status: 409,
    });
  }
  const sessionId = task.bdsSessionId ?? input.sessions.listSessions()[0]?.sessionId;
  for (const actionId of task.enqueuedActionIds ?? []) {
    if (!sessionId) break;
    // Remove actions still waiting in the controller queue. For an action
    // already delivered to BDS, retain the control.cancel fallback below.
    input.sessions.cancelQueuedAction(sessionId, actionId);
    const cancel = createActionRequest({
      sessionId,
      requestId: newId("req"),
      actionId: newId("action"),
      idempotencyKey: newId("idem"),
      toolName: "control.cancel",
      arguments: { actionId },
      actor: input.cancelledBy,
      permissionMode: task.permissionMode ?? "confirm_every_change",
      risk: "normal",
      noApprovalReason: "task_cancel",
    });
    input.sessions.enqueue(sessionId, cancel);
  }
  task.state = "cancelled";
  task.updatedAt = new Date().toISOString();
  input.audit.append({
    type: "task_cancelled",
    taskId: task.id,
    actor: input.cancelledBy,
    actionIds: task.enqueuedActionIds ?? [],
  });
  input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
  return publicTask(task);
}
