import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  PROTOCOL_VERSION,
  AI_MODES,
  PERMISSION_MODES,
  THINKING_LEVELS,
  createEnvelope,
  isProtocolCompatible,
  newId,
  validateActionRequest,
  validateHandshake,
  validateHeartbeat,
  validateOperationEvent,
  validatePoll,
  type ActionRequestMessage,
  type PermissionMode,
  type AiMode,
  type ThinkingLevel,
} from "@intelacraft/shared-protocol";
import type { ActivityStore } from "./activity.js";
import type { AuditLog } from "./audit.js";
import type { ControllerConfig } from "./config.js";
import { readJson, requireAuth, sendJson } from "./http.js";
import type { EventStore, SessionStore, SettingsStore } from "./store.js";
import { approvalRequired, classify, enforceMode, payloadHash } from "./policy.js";
import type { AgentRuntime } from "./agent.js";
import { tryServeStatic } from "./static.js";

export interface AppContext {
  config: ControllerConfig;
  sessions: SessionStore;
  events: EventStore;
  audit: AuditLog;
  activity: ActivityStore;
  settings: SettingsStore;
  agent?: AgentRuntime;
}

export function createApp(ctx: AppContext) {
  return createServer(async (req, res) => {
    try {
      await handleRequest(ctx, req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      const errorDetails = err && typeof err === "object" ? (err as { status?: unknown; code?: unknown }) : {};
      const requestedStatus = typeof errorDetails.status === "number" ? errorDetails.status : undefined;
      const status = requestedStatus && requestedStatus >= 400 && requestedStatus < 600 ? requestedStatus : undefined;
      const code = typeof errorDetails.code === "string" ? errorDetails.code : undefined;
      if (
        status ||
        message === "Invalid JSON" ||
        message === "Body too large" ||
        message.includes("required") ||
        message.startsWith("API key") ||
        message.startsWith("Provider ") ||
        message.startsWith("Unknown provider") ||
        message.includes("invalid") ||
        message.includes("API key")
      ) {
        sendJson(res, status ?? 400, { error: { code: code ?? "BAD_REQUEST", message } });
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: { code: "INTERNAL", message } });
    }
  });
}

async function handleRequest(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/v1/health") {
    return handleHealth(ctx, res);
  }

  // Static webview (unauthenticated) — API under /v1 always wins
  if (method === "GET" && !path.startsWith("/v1/")) {
    if (tryServeStatic(req, res, ctx.config.webviewDistPath, path)) return;
  }

  if (!requireAuth(req, res, ctx.config.bdsToken)) {
    return;
  }

  if (method === "POST" && path === "/v1/bds/handshake") {
    return handleHandshake(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/bds/poll") {
    return handlePoll(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/bds/events") {
    return handleEvents(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/bds/heartbeat") {
    return handleHeartbeat(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/actions") {
    return handleEnqueueAction(ctx, req, res);
  }
  if (method === "GET" && path === "/v1/events") {
    return handleListEvents(ctx, res);
  }
  if (method === "GET" && path === "/v1/events/stream") {
    return handleEventStream(ctx, req, res);
  }
  if (method === "GET" && path === "/v1/activity") {
    return handleActivityQuery(ctx, url, res);
  }
  if (method === "DELETE" && path === "/v1/activity") {
    const result = ctx.activity.purge();
    ctx.audit.append({ type: "activity_purged", removed: result.removed, actor: "controller" });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }
  if (method === "GET" && path === "/v1/settings") {
    sendJson(res, 200, {
      ...ctx.settings.get(),
      adminCommands: Object.entries(ctx.config.adminCommands).map(([id, e]) => ({
        id,
        label: e.label,
        risk: e.risk,
      })),
    });
    return;
  }
  if (method === "PATCH" && path === "/v1/settings") {
    const body = (await readJson(req)) as { permissionMode?: string; thinkingLevel?: string };
    if (
      body.permissionMode &&
      !(PERMISSION_MODES as readonly string[]).includes(body.permissionMode)
    ) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid permissionMode" } });
      return;
    }
    if (body.thinkingLevel && !(THINKING_LEVELS as readonly string[]).includes(body.thinkingLevel)) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid thinkingLevel" } });
      return;
    }
    const next = ctx.settings.patch({
      permissionMode: body.permissionMode as PermissionMode | undefined,
      thinkingLevel: body.thinkingLevel as ThinkingLevel | undefined,
    });
    if (body.thinkingLevel && ctx.agent) {
      ctx.agent.setThinkingLevel(body.thinkingLevel as ThinkingLevel);
    }
    ctx.audit.append({ type: "settings_updated", ...next });
    sendJson(res, 200, next);
    return;
  }
  if (method === "POST" && path === "/v1/emergency-disable") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const sessionId =
      typeof body.sessionId === "string"
        ? body.sessionId
        : ctx.sessions.listSessions()[0]?.sessionId;
    if (!sessionId || !ctx.sessions.setEmergencyDisabled(sessionId, body.disabled !== false)) {
      sendJson(res, 404, { error: { code: "NO_SESSION", message: "Unknown session" } });
      return;
    }
    ctx.audit.append({
      type: "emergency_disable",
      sessionId,
      disabled: body.disabled !== false,
      actor: body.actor ?? "controller",
    });
    sendJson(res, 200, {
      ok: true,
      sessionId,
      emergencyDisabled: body.disabled !== false,
    });
    return;
  }

  if (ctx.agent && method === "GET" && path === "/v1/providers") {
    const active = ctx.agent.getActiveProvider();
    sendJson(res, 200, {
      providers: ctx.agent.listProviders(),
      activeProviderId: active.activeProviderId,
    });
    return;
  }
  if (ctx.agent && method === "POST" && path === "/v1/providers") {
    const b = (await readJson(req)) as any;
    sendJson(res, 201, { provider: ctx.agent.saveProvider(b) });
    return;
  }
  if (ctx.agent && method === "POST" && path === "/v1/providers/active") {
    const b = (await readJson(req)) as any;
    sendJson(res, 200, ctx.agent.setActiveProvider(String(b.providerId ?? "")));
    return;
  }
  const providerTest = /^\/v1\/providers\/([^/]+)\/(test|models)$/.exec(path);
  if (ctx.agent && method === "POST" && providerTest) {
    const id = decodeURIComponent(providerTest[1]);
    sendJson(
      res,
      200,
      providerTest[2] === "test" ? await ctx.agent.test(id) : { models: await ctx.agent.models(id) },
    );
    return;
  }
  if (ctx.agent && method === "GET" && path === "/v1/mcp/status") {
    sendJson(res, 200, ctx.agent.mcp.status());
    return;
  }
  if (ctx.agent && method === "POST" && path === "/v1/pi/sessions") {
    const b = (await readJson(req)) as any;
    sendJson(res, 201, { session: await ctx.agent.createSession(String(b.providerId ?? "default")) });
    return;
  }
  if (ctx.agent && method === "GET" && path === "/v1/pi/sessions") {
    sendJson(res, 200, { sessions: ctx.agent.listSessions() });
    return;
  }
  if (ctx.agent && method === "POST" && path === "/v1/tasks") {
    const b = (await readJson(req)) as any;
    const bdsSessionId = String(
      b.bdsSessionId ?? ctx.sessions.listSessions()[0]?.sessionId ?? "",
    );
    if (!bdsSessionId) {
      sendJson(res, 400, { error: { code: "NO_SESSION", message: "No BDS session" } });
      return;
    }
    const permissionMode =
      (b.permissionMode as PermissionMode | undefined) ?? ctx.settings.get().permissionMode;
    const mode = b.mode === undefined ? "ask" : String(b.mode);
    if (!(AI_MODES as readonly string[]).includes(mode)) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid mode" } });
      return;
    }
    const task = await ctx.agent.createTask({
      ...b,
      bdsSessionId,
      permissionMode,
      mode: mode as AiMode,
      sessions: ctx.sessions,
      audit: ctx.audit,
    });
    ctx.audit.append({
      type: "task_lifecycle",
      taskId: task.id,
      state: task.state,
      mode: task.mode,
      request: b.request,
    });
    sendJson(res, 201, { task });
    return;
  }
  if (ctx.agent && method === "POST" && path === "/v1/tasks/stream") {
    const b = (await readJson(req)) as any;
    const bdsSessionId = String(
      b.bdsSessionId ?? ctx.sessions.listSessions()[0]?.sessionId ?? "",
    );
    if (!bdsSessionId) {
      sendJson(res, 400, { error: { code: "NO_SESSION", message: "No BDS session" } });
      return;
    }
    const permissionMode =
      (b.permissionMode as PermissionMode | undefined) ?? ctx.settings.get().permissionMode;
    const mode = b.mode === undefined ? "ask" : String(b.mode);
    if (!(AI_MODES as readonly string[]).includes(mode)) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid mode" } });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Prevent proxies and dev servers from collecting model deltas until the
      // response completes.  SSE only feels live when each frame is forwarded.
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    });
    res.socket?.setNoDelay(true);
    res.flushHeaders();
    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    writeEvent("ready", { ok: true });
    try {
      const task = await ctx.agent.createTaskStream(
        {
          ...b,
          bdsSessionId,
          permissionMode,
          mode: mode as AiMode,
          sessions: ctx.sessions,
          audit: ctx.audit,
        },
        (event) => {
          if (event.type === "delta") writeEvent("delta", { text: event.text });
          else if (event.type === "reasoning_delta") writeEvent("reasoning_delta", { text: event.text });
          else if (event.type === "status") writeEvent("status", { text: event.text });
          else if (event.type === "tool") writeEvent("tool", event);
        },
      );
      ctx.audit.append({
        type: "task_lifecycle",
        taskId: task.id,
        state: task.state,
        mode: task.mode,
        request: b.request,
      });
      writeEvent("task", { task });
    } catch (e) {
      writeEvent("error", {
        message: e instanceof Error ? e.message : "Planning failed",
      });
    }
    res.end();
    return;
  }
  if (ctx.agent && method === "GET" && path === "/v1/tasks") {
    sendJson(res, 200, { tasks: ctx.agent.listTasks() });
    return;
  }
  const taskAction = /^\/v1\/tasks\/([^/]+)\/(approve|reject|cancel|replan)$/.exec(path);
  if (ctx.agent && method === "POST" && taskAction) {
    const taskId = decodeURIComponent(taskAction[1]);
    const action = taskAction[2];
    const b = (await readJson(req)) as Record<string, unknown>;
    try {
      if (action === "approve") {
        const task = ctx.agent.approveTask(taskId, {
          approvedBy: String(b.approvedBy ?? "webview"),
          sessions: ctx.sessions,
          audit: ctx.audit,
        });
        sendJson(res, 200, { task });
        return;
      }
      if (action === "reject") {
        const task = ctx.agent.rejectTask(taskId, {
          rejectedBy: String(b.rejectedBy ?? "webview"),
          audit: ctx.audit,
          reason: typeof b.reason === "string" ? b.reason : undefined,
        });
        sendJson(res, 200, { task });
        return;
      }
      if (action === "cancel") {
        const task = ctx.agent.cancelTask(taskId, {
          cancelledBy: String(b.cancelledBy ?? "webview"),
          sessions: ctx.sessions,
          audit: ctx.audit,
        });
        sendJson(res, 200, { task });
        return;
      }
      if (action === "replan") {
        const task = await ctx.agent.editAndReplan(taskId, {
          notes: String(b.notes ?? b.request ?? "Please revise the plan."),
          sessions: ctx.sessions,
          audit: ctx.audit,
          history: Array.isArray(b.history) ? (b.history as any) : undefined,
        });
        sendJson(res, 200, { task });
        return;
      }
    } catch (e: any) {
      sendJson(res, e.status ?? 500, {
        error: { code: e.code ?? "ERROR", message: e.message ?? "Task action failed" },
      });
      return;
    }
  }
  const taskStreamMatch = /^\/v1\/tasks\/([^/]+)\/stream$/.exec(path);
  if (ctx.agent && method === "POST" && taskStreamMatch) {
    const taskId = decodeURIComponent(taskStreamMatch[1]);
    const b = (await readJson(req)) as any;
    const mode = b.mode === undefined ? undefined : String(b.mode);
    if (mode !== undefined && !(AI_MODES as readonly string[]).includes(mode)) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid mode" } });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    });
    res.socket?.setNoDelay(true);
    res.flushHeaders();
    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    writeEvent("ready", { ok: true });
    try {
      const task = await ctx.agent.continueTask(
        taskId,
        {
          ...b,
          ...(mode === undefined ? {} : { mode: mode as AiMode }),
          sessions: ctx.sessions,
          audit: ctx.audit,
        },
        (event) => {
          if (event.type === "delta") writeEvent("delta", { text: event.text });
          else if (event.type === "reasoning_delta") writeEvent("reasoning_delta", { text: event.text });
          else if (event.type === "status") writeEvent("status", { text: event.text });
          else if (event.type === "tool") writeEvent("tool", event);
        },
      );
      ctx.audit.append({
        type: "task_lifecycle",
        taskId: task.id,
        state: task.state,
        mode: task.mode,
        request: b.request,
      });
      writeEvent("task", { task });
    } catch (e) {
      writeEvent("error", {
        message: e instanceof Error ? e.message : "Continue failed",
      });
    }
    res.end();
    return;
  }
  const taskMatch = /^\/v1\/tasks\/([^/]+)$/.exec(path);
  if (ctx.agent && method === "GET" && taskMatch) {
    const id = decodeURIComponent(taskMatch[1]);
    const task = ctx.agent.getTask(id);
    if (!task) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Task not found" } });
      return;
    }
    sendJson(res, 200, {
      task,
      transcript: ctx.agent.getTaskTranscript(id),
    });
    return;
  }
  if (ctx.agent && method === "DELETE" && taskMatch) {
    try {
      ctx.agent.deleteTask(decodeURIComponent(taskMatch[1]));
      sendJson(res, 200, { ok: true });
    } catch (e) {
      const err = e as Error;
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: err.message } });
    }
    return;
  }

  sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
}

function handleHealth(ctx: AppContext, res: ServerResponse): void {
  const now = Date.now();
  const sessions = ctx.sessions.listSessions().map((s) => {
    const ageMs = s.lastHeartbeatAt ? now - Date.parse(s.lastHeartbeatAt) : null;
    const connected =
      ageMs !== null && !Number.isNaN(ageMs) && ageMs <= ctx.config.heartbeatStaleMs;
    return {
      sessionId: s.sessionId,
      serverId: s.serverId,
      protocolVersion: s.protocolVersion,
      connectedAt: s.connectedAt,
      lastHeartbeatAt: s.lastHeartbeatAt,
      heartbeatAgeMs: ageMs,
      connected,
      health: s.lastHealth,
      emergencyDisabled: ctx.sessions.isEmergencyDisabled(s.sessionId),
    };
  });
  sendJson(res, 200, {
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    bdsConnected: sessions.some((s) => s.connected),
    sessions,
    settings: ctx.settings.get(),
    agent: ctx.agent
      ? {
          pi: true,
          sessions: ctx.agent.listSessions().length,
          providers: ctx.agent.listProviders().length,
          activeProviderId: ctx.agent.getActiveProvider().activeProviderId,
          mcp: ctx.agent.mcp.status(),
        }
      : { pi: false },
  });
}

async function handleHandshake(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  const parsed = validateHandshake(body);
  if (!parsed.ok) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }
  if (!isProtocolCompatible(parsed.value.clientProtocolVersion)) {
    sendJson(res, 400, {
      error: {
        code: "PROTOCOL_INCOMPATIBLE",
        message: `Incompatible protocol ${parsed.value.clientProtocolVersion}`,
      },
    });
    return;
  }

  const sessionId = newId("session");
  const now = new Date().toISOString();
  ctx.sessions.upsertSession({
    sessionId,
    serverId: parsed.value.serverId,
    connectedAt: now,
    lastHeartbeatAt: null,
    lastHealth: null,
    protocolVersion: PROTOCOL_VERSION,
  });

  ctx.audit.append({
    type: "handshake",
    serverId: parsed.value.serverId,
    sessionId,
    requestId: parsed.value.requestId,
  });

  sendJson(res, 200, {
    ...createEnvelope("handshake_ack", sessionId, parsed.value.requestId),
    messageType: "handshake_ack",
    acceptedProtocolVersion: PROTOCOL_VERSION,
    serverId: parsed.value.serverId,
    ok: true,
  });
}

async function handlePoll(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  const parsed = validatePoll(body);
  if (!parsed.ok) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }
  const session = ctx.sessions.getSession(parsed.value.sessionId);
  if (!session) {
    sendJson(res, 401, {
      error: { code: "NO_SESSION", message: "Unknown or expired session" },
    });
    return;
  }
  const action = ctx.sessions.dequeue(parsed.value.sessionId);
  sendJson(res, 200, {
    ...createEnvelope("poll_response", parsed.value.sessionId, parsed.value.requestId),
    messageType: "poll_response",
    action,
  });
}

async function handleEvents(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  const parsed = validateOperationEvent(body);
  if (!parsed.ok) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }
  const session = ctx.sessions.getSession(parsed.value.sessionId);
  if (!session) {
    sendJson(res, 401, {
      error: { code: "NO_SESSION", message: "Unknown or expired session" },
    });
    return;
  }
  ctx.events.add(parsed.value);
  ctx.audit.append({
    type: "operation_event",
    sessionId: parsed.value.sessionId,
    serverId: session.serverId,
    actionId: parsed.value.actionId,
    operationId: parsed.value.operationId,
    state: parsed.value.state,
    message: parsed.value.message,
    result: parsed.value.result,
    error: parsed.value.error,
  });
  await ctx.agent?.onOperationEvent(parsed.value.actionId, parsed.value.state, ctx.audit, {
    message: parsed.value.message,
    result: parsed.value.result,
    sessions: ctx.sessions,
  });
  sendJson(res, 200, { ok: true });
}

async function handleHeartbeat(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  const parsed = validateHeartbeat(body);
  if (!parsed.ok) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }
  const ok = ctx.sessions.touchHeartbeat(parsed.value.sessionId, parsed.value.health);
  if (!ok) {
    sendJson(res, 401, {
      error: { code: "NO_SESSION", message: "Unknown or expired session" },
    });
    return;
  }
  sendJson(res, 200, { ok: true });
}

async function handleEnqueueAction(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  let action: ActionRequestMessage;

  if (
    typeof body === "object" &&
    body !== null &&
    "messageType" in body &&
    (body as { messageType?: string }).messageType === "action_request"
  ) {
    const parsed = validateActionRequest(body);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    action = parsed.value;
  } else if (typeof body === "object" && body !== null) {
    const input = body as Record<string, unknown>;
    const sessionId =
      typeof input.sessionId === "string"
        ? input.sessionId
        : ctx.sessions.listSessions()[0]?.sessionId;
    if (!sessionId) {
      sendJson(res, 400, {
        error: { code: "NO_SESSION", message: "No active BDS session" },
      });
      return;
    }
    let args: Record<string, unknown> =
      typeof input.arguments === "object" && input.arguments !== null
        ? { ...(input.arguments as Record<string, unknown>) }
        : {};
    if (input.toolName === "admin.run_command") {
      const commandId = String(args.commandId ?? "");
      const entry = ctx.config.adminCommands[commandId];
      if (!entry) {
        sendJson(res, 400, {
          error: { code: "UNKNOWN_COMMAND", message: `Unknown commandId '${commandId}'` },
        });
        return;
      }
      args = { commandId, command: entry.command };
    }
    const toolName = String(input.toolName ?? "");
    const defaultRisk =
      typeof input.risk === "string"
        ? input.risk
        : toolName.startsWith("inspect.")
          ? "read"
          : toolName === "admin.run_command"
            ? (ctx.config.adminCommands[String(args.commandId)]?.risk ?? "normal")
            : toolName === "control.emergency_disable"
              ? "strong"
              : "normal";
    const draft = {
      ...createEnvelope("action_request", sessionId, newId("req")),
      messageType: "action_request" as const,
      actionId: typeof input.actionId === "string" ? input.actionId : newId("action"),
      idempotencyKey:
        typeof input.idempotencyKey === "string" ? input.idempotencyKey : newId("idem"),
      toolName: input.toolName,
      arguments: args,
      actor: typeof input.actor === "string" ? input.actor : "controller",
      permissionMode: input.permissionMode ?? ctx.settings.get().permissionMode,
      risk: defaultRisk,
      noApprovalReason:
        typeof input.noApprovalReason === "string"
          ? input.noApprovalReason
          : "pending_approval_check",
      expiresAt:
        typeof input.expiresAt === "string"
          ? input.expiresAt
          : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    const parsed = validateActionRequest(draft);
    if (!parsed.ok) {
      sendJson(res, 400, { error: parsed.error });
      return;
    }
    action = parsed.value;
  } else {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid body" } });
    return;
  }

  const policy = {
    protectedRegions: ctx.config.protectedRegions,
    builderRegions: ctx.config.builderRegions,
    adminCommands: ctx.config.adminCommands,
  };
  const classification = classify(action, policy);
  if (classification.risk !== action.risk) {
    // Auto-correct risk for convenience drafts when client sent default "read"
    if (
      action.risk === "read" &&
      classification.risk !== "read" &&
      classification.risk !== "prohibited"
    ) {
      action = { ...action, risk: classification.risk, noApprovalReason: undefined };
    } else {
      sendJson(res, 400, {
        error: {
          code: "RISK_MISMATCH",
          message: `Expected risk ${classification.risk}: ${classification.reason}`,
        },
      });
      return;
    }
  }
  const denied = enforceMode(action.permissionMode, action, policy);
  if (denied) {
    ctx.audit.append({
      type: "policy_denied",
      actionId: action.actionId,
      toolName: action.toolName,
      actor: action.actor,
      reason: denied,
      risk: action.risk,
    });
    sendJson(res, 403, { error: { code: "POLICY_DENIED", message: denied } });
    return;
  }
  const hash = payloadHash(action);
  if (approvalRequired(action.permissionMode, action.risk, action, policy)) {
    if (!action.approval) {
      sendJson(res, 409, {
        error: { code: "APPROVAL_REQUIRED", message: "Exact payload approval required" },
        approval: { payloadHash: hash, risk: action.risk, action },
      });
      return;
    }
    if (action.approval.payloadHash !== hash) {
      sendJson(res, 409, {
        error: {
          code: "APPROVAL_INVALID",
          message: "Approval does not match immutable action payload",
        },
      });
      return;
    }
    if (Date.now() - Date.parse(action.approval.approvedAt) > 5 * 60 * 1000) {
      sendJson(res, 409, {
        error: { code: "APPROVAL_EXPIRED", message: "Approval is stale" },
      });
      return;
    }
    ctx.audit.append({
      type: "approval_granted",
      actionId: action.actionId,
      actor: action.approval.approvedBy,
      risk: action.risk,
      payloadHash: hash,
      toolName: action.toolName,
    });
  }
  if (ctx.sessions.isEmergencyDisabled(action.sessionId) && action.risk !== "read") {
    sendJson(res, 503, {
      error: { code: "EMERGENCY_DISABLED", message: "Mutations are disabled" },
    });
    return;
  }
  const result = ctx.sessions.enqueue(action.sessionId, action);
  if (!result.ok) {
    sendJson(res, 409, { error: { code: result.code, message: result.message } });
    return;
  }

  ctx.audit.append({
    type: "action_enqueued",
    sessionId: action.sessionId,
    actionId: action.actionId,
    toolName: action.toolName,
    actor: action.actor,
    risk: action.risk,
    arguments: action.arguments,
  });

  sendJson(res, 202, {
    ok: true,
    actionId: action.actionId,
    sessionId: action.sessionId,
    idempotencyKey: action.idempotencyKey,
  });
}

function handleListEvents(ctx: AppContext, res: ServerResponse): void {
  sendJson(res, 200, { events: ctx.events.recent(100) });
}

function handleActivityQuery(ctx: AppContext, url: URL, res: ServerResponse): void {
  const records = ctx.activity.query({
    taskId: url.searchParams.get("taskId") ?? undefined,
    actionId: url.searchParams.get("actionId") ?? undefined,
    operationId: url.searchParams.get("operationId") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 100,
  });
  sendJson(res, 200, { records });
}

function handleEventStream(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    });
    res.socket?.setNoDelay(true);
    res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const unsub = ctx.events.subscribe((record) => {
    res.write(`event: operation\ndata: ${JSON.stringify(record)}\n\n`);
  });
  const keepAlive = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);
  req.on("close", () => {
    clearInterval(keepAlive);
    unsub();
  });
}
