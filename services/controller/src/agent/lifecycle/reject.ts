import type { AuditLog } from "../../audit.js";
import { publicTask } from "../task-store.js";
import type { AgentContext } from "../types.js";

export function rejectTask(
  ctx: AgentContext,
  taskId: string,
  input: { rejectedBy: string; audit: AuditLog; reason?: string },
) {
  const task = ctx.tasks.get(taskId);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
  if (task.state !== "awaiting_approval" && task.state !== "planned") {
    throw Object.assign(new Error(`Task cannot be rejected in state ${task.state}`), {
      code: "INVALID_STATE",
      status: 409,
    });
  }
  task.state = "rejected";
  task.error = input.reason ?? "Rejected by user";
  task.updatedAt = new Date().toISOString();
  input.audit.append({
    type: "approval_rejected",
    taskId: task.id,
    actor: input.rejectedBy,
    reason: task.error,
  });
  input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
  return publicTask(task);
}
