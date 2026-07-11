import type { InspectionToolName } from "@intelacraft/pi-extension";
import type { AuditLog } from "../../audit.js";
import type { SessionStore } from "../../store.js";
import type { AgentContext, AgentTask } from "../types.js";
import { stableJson } from "../sanitize.js";
import { materializeAction } from "./materialize.js";

/** Maximum distinct live world reads available to one AI planning turn. */
export const MAX_INSPECTION_CALLS_PER_TURN = 16;

export function createBoundedInspectionExecutor(
  ctx: AgentContext,
  task: AgentTask,
  cache: Map<string, Promise<{ message: string; result?: unknown }>>,
  execute: (
    toolName: InspectionToolName,
    arguments_: Record<string, unknown>,
  ) => Promise<{ message: string; result?: unknown }>,
) {
  let uniqueCalls = 0;
  return async (toolName: InspectionToolName, arguments_: Record<string, unknown>) => {
    const key = `${toolName}:${stableJson(arguments_)}`;
    const cached = cache.get(key);
    if (cached) {
      task.metrics = {
        ...(task.metrics ?? {}),
        inspectionCacheHits: (task.metrics?.inspectionCacheHits ?? 0) + 1,
      };
      return cached;
    }
    if (uniqueCalls >= MAX_INSPECTION_CALLS_PER_TURN) {
      // This is a normal planning boundary, not a failed tool execution.
      // Throwing here caused providers to retain the failure as conversation
      // context, making a later user turn appear to inherit this turn's cap.
      return {
        message: `Inspection budget exhausted (${MAX_INSPECTION_CALLS_PER_TURN} unique calls). Use the observations already gathered and finish the plan.`,
        result: { inspectionBudgetExhausted: true, maxUniqueCalls: MAX_INSPECTION_CALLS_PER_TURN },
      };
    }
    uniqueCalls += 1;
    task.metrics = {
      ...(task.metrics ?? {}),
      inspectionToolCalls: (task.metrics?.inspectionToolCalls ?? 0) + 1,
    };
    const pending = execute(toolName, arguments_);
    cache.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  };
}

export async function executePiInspection(
  ctx: AgentContext,
  task: AgentTask,
  toolName: InspectionToolName,
  arguments_: Record<string, unknown>,
  sessions: SessionStore,
  audit: AuditLog,
): Promise<{ message: string; result?: unknown }> {
  const action = materializeAction(
    ctx,
    { toolName, arguments: arguments_ },
    {
      bdsSessionId: task.bdsSessionId!,
      actor: task.actor,
      permissionMode: task.permissionMode,
    },
    true,
  );
  const queued = sessions.enqueue(action.sessionId, action);
  if (!queued.ok) throw new Error(queued.message);
  task.enqueuedActionIds = [...(task.enqueuedActionIds ?? []), action.actionId];
  task.inspectActionIds = [...(task.inspectActionIds ?? []), action.actionId];
  task.actionToolNames = { ...(task.actionToolNames ?? {}), [action.actionId]: action.toolName };
  task.state = "inspecting";
  audit.append({
    type: "action_enqueued",
    taskId: task.id,
    sessionId: action.sessionId,
    actionId: action.actionId,
    toolName: action.toolName,
    actor: action.actor,
    risk: action.risk,
    arguments: action.arguments,
    noApprovalReason: "agent_inspection",
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.inspectionWaiters.delete(action.actionId);
      reject(new Error(`${toolName} timed out waiting for the Bedrock server`));
    }, 30_000);
    ctx.inspectionWaiters.set(action.actionId, { resolve, reject, timer });
  });
}

export function resolveInspectionWaiter(
  ctx: AgentContext,
  actionId: string,
  state: string,
  detail?: { message?: string; result?: unknown },
): boolean {
  const inspectionWaiter = ctx.inspectionWaiters.get(actionId);
  const terminalInspection =
    state === "completed" ||
    state === "partially_completed" ||
    state === "failed" ||
    state === "cancelled";
  if (!inspectionWaiter || !terminalInspection) return false;
  clearTimeout(inspectionWaiter.timer);
  ctx.inspectionWaiters.delete(actionId);
  if (state === "completed" || state === "partially_completed") {
    inspectionWaiter.resolve({ message: detail?.message ?? state, result: detail?.result });
  } else {
    inspectionWaiter.reject(new Error(detail?.message ?? `Inspection ${state}`));
  }
  return true;
}
