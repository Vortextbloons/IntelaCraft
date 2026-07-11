import { newId, type AiMode } from "@intelacraft/shared-protocol";
import {
  planWithPiSession,
  redactSecrets,
  refreshPiSessionProvider,
  setPiInspectionExecutor,
  setPiCatalogExecutor,
  type AgentPlan,
  type ChatTurn,
  type PlanStreamEvent,
  type ThinkingLevel,
} from "@intelacraft/pi-extension";
import type { AuditLog } from "../../audit.js";
import type { SessionStore } from "../../store.js";
import { appendHistory, planHistoryText, resolveHistory } from "../chat-history.js";
import { createBoundedInspectionExecutor, executePiInspection } from "../inspection/bridge.js";
import {
  applyPlanToTask,
  buildWorldContext,
  materializeAction,
  validatePlanTools,
} from "../inspection/materialize.js";
import { needProvider } from "../provider-store.js";
import { persistTasks, publicTask } from "../task-store.js";
import type { AgentContext, AgentTask, CreateTaskInput, PlanInput } from "../types.js";

const ACTIVE_TASK_STATES = new Set(["submitted", "planning", "inspecting", "running", "verifying"]);

function assertPiSessionAvailable(ctx: AgentContext, piSessionId: string, excludeTaskId?: string) {
  const active = [...ctx.tasks.values()].find(
    (task) => task.id !== excludeTaskId && task.piSessionId === piSessionId && ACTIVE_TASK_STATES.has(task.state),
  );
  if (active) {
    throw Object.assign(
      new Error("The AI is still working on another task. Wait for it to finish before sending a message."),
      { code: "AI_BUSY", status: 409 },
    );
  }
}

/** Enqueue pending read-only inspect actions without an approval record. */
export function enqueuePendingReads(ctx: AgentContext, task: AgentTask, sessions: SessionStore, audit: AuditLog) {
  const actions = task.pendingReads ?? [];
  if (actions.length === 0) {
    if (task.state === "planned" && (task.proposedActions?.length ?? 0) === 0) {
      task.state = "completed";
      audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    }
    return;
  }
  const enqueued: string[] = [...(task.enqueuedActionIds ?? [])];
  const inspectIds: string[] = [...(task.inspectActionIds ?? [])];
  for (const action of actions) {
    const result = sessions.enqueue(action.sessionId, {
      ...action,
      noApprovalReason: "read_risk_no_approval",
    });
    if (!result.ok) {
      task.state = "failed";
      task.error = result.message;
      audit.append({
        type: "task_lifecycle",
        taskId: task.id,
        state: task.state,
        error: result.message,
      });
      return;
    }
    enqueued.push(action.actionId);
    inspectIds.push(action.actionId);
    audit.append({
      type: "action_enqueued",
      taskId: task.id,
      sessionId: action.sessionId,
      actionId: action.actionId,
      toolName: action.toolName,
      actor: action.actor,
      risk: action.risk,
      arguments: action.arguments,
      noApprovalReason: "read_risk_no_approval",
    });
  }
  task.enqueuedActionIds = enqueued;
  task.inspectActionIds = inspectIds;
  task.pendingReads = [];
  if (task.state === "planned") {
    task.state = "running";
    audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
  } else if (task.state === "inspecting") {
    audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
  }
}

export function enqueueVerification(ctx: AgentContext, task: AgentTask, sessions: SessionStore, audit: AuditLog) {
  const actions = task.pendingVerification ?? [];
  if (actions.length === 0) {
    task.state = "completed";
    audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    return;
  }
  task.state = "verifying";
  const enqueued: string[] = [...(task.enqueuedActionIds ?? [])];
  const verifyIds: string[] = [];
  for (const action of actions) {
    const result = sessions.enqueue(action.sessionId, {
      ...action,
      noApprovalReason: "read_risk_no_approval",
    });
    if (!result.ok) {
      task.state = "partial";
      task.error = result.message;
      audit.append({
        type: "task_lifecycle",
        taskId: task.id,
        state: task.state,
        error: result.message,
      });
      return;
    }
    enqueued.push(action.actionId);
    verifyIds.push(action.actionId);
    audit.append({
      type: "action_enqueued",
      taskId: task.id,
      sessionId: action.sessionId,
      actionId: action.actionId,
      toolName: action.toolName,
      actor: action.actor,
      risk: action.risk,
      arguments: action.arguments,
      noApprovalReason: "verification_read",
    });
  }
  task.enqueuedActionIds = enqueued;
  task.verifyActionIds = verifyIds;
  task.pendingVerification = [];
  audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
}

export async function planWithValidationRetry(
  ctx: AgentContext,
  sessionId: string,
  request: string,
  world: unknown,
  mcp: unknown,
  opts: {
    thinkingLevel?: ThinkingLevel;
    mode?: AiMode;
    adminCommandIds?: string[];
    history?: ChatTurn[];
    onEvent?: (event: PlanStreamEvent) => void;
    validationError?: string;
  },
  task: AgentTask,
  input: PlanInput,
): Promise<AgentPlan> {
  const inspectionCache = new Map<
    string,
    Promise<{ message: string; result?: unknown }>
  >();
  if (input.sessions && input.audit) {
    setPiInspectionExecutor(
      sessionId,
      createBoundedInspectionExecutor(ctx, task, inspectionCache, (toolName, arguments_) =>
        executePiInspection(ctx, task, toolName, arguments_, input.sessions!, input.audit!),
      ),
    );
  }
  setPiCatalogExecutor(sessionId, async (operation, args) => {
    const catalog = ctx.catalog;
    const kind = args.kind as "block" | "item" | "entity";
    if (!catalog || !catalog.status(input.bdsSessionId).available) {
      const unavailable = operation === "search"
        ? { catalogAvailable: false, kind, query: String(args.query ?? ""), matches: [], revision: 0 }
        : { catalogAvailable: false, kind, id: String(args.id ?? ""), valid: false, suggestions: [] };
      return { message: "The connected server has not synchronized its content catalog", result: { ...unavailable, message: "The connected server has not synchronized its content catalog." } };
    }
    if (operation === "search") return { message: "Catalog search complete", result: { catalogAvailable: true, ...catalog.search(input.bdsSessionId, kind, String(args.query ?? ""), typeof args.limit === "number" ? args.limit : 8) } };
    return { message: "Catalog resolution complete", result: { catalogAvailable: true, ...catalog.resolve(input.bdsSessionId, kind, String(args.id ?? "")) } };
  });
  let lastError: string | undefined = opts.validationError;
  // Pi may finish the prompt before its queued tool callback is dispatched.
  // Keep the bridge bound to this Pi session until a later planning turn
  // replaces it; clearing it here caused those callbacks to fail before an
  // inspection action could be sent to BDS.
  for (let attempt = 0; attempt < 2; attempt++) {
    const plan = await planWithPiSession(sessionId, request, world, mcp, {
      ...opts,
      validationError: lastError,
    });
    try {
      validatePlanTools(ctx, plan, opts.mode ?? task.mode);
      // Dry-run materialize to catch arg errors before applying.
      for (const step of plan.inspection) materializeAction(ctx, step, input, true);
      for (const step of plan.actions) materializeAction(ctx, step, input, false);
      for (const step of plan.verification) materializeAction(ctx, step, input, true);
      return plan;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Invalid plan";
      task.metrics = {
        ...(task.metrics ?? {}),
        validationRetries: (task.metrics?.validationRetries ?? 0) + 1,
      };
      if (attempt === 1) throw e;
      opts.onEvent?.({
        type: "tool",
        name: "validate_plan",
        phase: "start",
        detail: lastError,
      });
    }
  }
  throw new Error(lastError ?? "Planning failed");
}

export async function createTaskInternal(
  ctx: AgentContext,
  input: CreateTaskInput,
  onEvent?: (event: PlanStreamEvent) => void,
) {
  const s = ctx.pi.get(input.piSessionId);
  if (!s) throw new Error("Unknown Pi session");
  assertPiSessionAvailable(ctx, s.id);
  const task: AgentTask = {
    id: newId("task"),
    piSessionId: s.id,
    request: input.request,
    state: "submitted",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    bdsSessionId: input.bdsSessionId,
    actor: input.actor ?? "pi-agent",
    permissionMode: input.permissionMode ?? ctx.config.defaultPermissionMode,
    mode: input.mode ?? "ask",
    completedActionIds: [],
    metrics: { validationRetries: 0 },
  };
  s.mode = task.mode;
  ctx.tasks.set(task.id, task);
  persistTasks(ctx);
  task.state = "planning";
  // Structured tool-call responses may contain no visible text deltas.
  onEvent?.({ type: "status", text: "Planning response…" });
  const planStarted = Date.now();
  try {
    const advice = input.useMcp === false ? null : await ctx.mcp.query(input.request);
    const provider = needProvider(ctx, s.providerId);
    await refreshPiSessionProvider(s, provider, ctx.thinkingLevel);
    const world = buildWorldContext(ctx, input.sessions, input.worldContext);
    const mcp = advice == null ? undefined : redactSecrets(advice);
    const history = resolveHistory(ctx, s.id, input.history);
    const adminCommandIds = Object.keys(ctx.config.adminCommands);

    const plan = await planWithValidationRetry(
      ctx,
      s.id,
      input.request,
      world,
      mcp,
      {
        thinkingLevel: ctx.thinkingLevel,
        mode: task.mode,
        adminCommandIds,
        history,
        onEvent,
      },
      task,
      input,
    );

    applyPlanToTask(ctx, task, plan, input);
    appendHistory(ctx, s.id, { role: "user", content: input.request });
    appendHistory(ctx, s.id, {
      role: "assistant",
      content: planHistoryText(plan),
    });
    if (input.sessions && input.audit) {
      enqueuePendingReads(ctx, task, input.sessions, input.audit);
    }
  } catch (e) {
    task.state = "failed";
    task.error = e instanceof Error ? e.message : "Planning failed";
  }
  task.metrics = {
    ...(task.metrics ?? {}),
    planLatencyMs: Date.now() - planStarted,
  };
  task.updatedAt = new Date().toISOString();
  return publicTask(task);
}

export async function continueTask(
  ctx: AgentContext,
  taskId: string,
  input: {
    request: string;
    worldContext?: unknown;
    useMcp?: boolean;
    mode?: AiMode;
    sessions?: SessionStore;
    audit?: AuditLog;
    history?: ChatTurn[];
  },
  onEvent?: (event: PlanStreamEvent) => void,
) {
  const task = ctx.tasks.get(taskId);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
  if (task.state === "planning") {
    throw Object.assign(new Error("Task is already planning — wait for it to finish"), {
      code: "INVALID_STATE",
      status: 409,
    });
  }
  // Continuing is only valid once this task is terminal/awaiting input. The
  // task itself must therefore also trip the active-work guard.
  assertPiSessionAvailable(ctx, task.piSessionId);
  const s = ctx.pi.get(task.piSessionId);
  if (!s) throw new Error("Pi session missing for task");
  task.mode = input.mode ?? task.mode ?? "ask";
  s.mode = task.mode;
  task.state = "planning";
  task.error = undefined;
  task.proposedActions = [];
  task.pendingReads = [];
  task.pendingVerification = [];
  task.enqueuedActionIds = [];
  task.completedActionIds = [];
  task.inspectActionIds = [];
  task.mutationActionIds = [];
  task.verifyActionIds = [];
  task.awaitingInspectReplan = false;
  task.updatedAt = new Date().toISOString();
  input.audit?.append({ type: "task_lifecycle", taskId: task.id, state: task.state, phase: "continue" });
  onEvent?.({ type: "status", text: "Planning response…" });
  const planStarted = Date.now();
  try {
    const advice = input.useMcp === false ? null : await ctx.mcp.query(input.request);
    const provider = needProvider(ctx, s.providerId);
    await refreshPiSessionProvider(s, provider, ctx.thinkingLevel);
    const world = buildWorldContext(ctx, input.sessions, input.worldContext);
    const mcp = advice == null ? undefined : redactSecrets(advice);
    const history = resolveHistory(ctx, s.id, input.history);
    const adminCommandIds = Object.keys(ctx.config.adminCommands);
    const plan = await planWithValidationRetry(
      ctx,
      s.id,
      input.request,
      world,
      mcp,
      {
        thinkingLevel: ctx.thinkingLevel,
        mode: task.mode,
        adminCommandIds,
        history,
        onEvent,
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
    task.request = `${task.request}\n\nFollow-up: ${input.request}`;
    applyPlanToTask(ctx, task, plan, {
      bdsSessionId: task.bdsSessionId!,
      actor: task.actor,
      permissionMode: task.permissionMode,
    });
    appendHistory(ctx, s.id, { role: "user", content: input.request });
    appendHistory(ctx, s.id, {
      role: "assistant",
      content: planHistoryText(plan),
    });
    if (input.sessions && input.audit) {
      enqueuePendingReads(ctx, task, input.sessions, input.audit);
    }
  } catch (e) {
    task.state = "failed";
    task.error = e instanceof Error ? e.message : "Continue failed";
  }
  task.metrics = {
    ...(task.metrics ?? {}),
    planLatencyMs: Date.now() - planStarted,
  };
  task.updatedAt = new Date().toISOString();
  return publicTask(task);
}
