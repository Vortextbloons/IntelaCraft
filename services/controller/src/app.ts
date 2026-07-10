import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  PROTOCOL_VERSION,
  createEnvelope,
  isProtocolCompatible,
  newId,
  validateActionRequest,
  validateHandshake,
  validateHeartbeat,
  validateOperationEvent,
  validatePoll,
  type ActionRequestMessage,
} from "@intelacraft/shared-protocol";
import type { AuditLog } from "./audit.js";
import type { ControllerConfig } from "./config.js";
import { readJson, requireAuth, sendJson } from "./http.js";
import type { EventStore, SessionStore } from "./store.js";
import { approvalRequired, classify, enforceMode, payloadHash } from "./policy.js";

export interface AppContext {
  config: ControllerConfig;
  sessions: SessionStore;
  events: EventStore;
  audit: AuditLog;
}

export function createApp(ctx: AppContext) {
  return createServer(async (req, res) => {
    try {
      await handleRequest(ctx, req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      if (message === "Invalid JSON" || message === "Body too large") {
        sendJson(res, 400, { error: { code: "BAD_REQUEST", message } });
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: { code: "INTERNAL", message: "Internal error" } });
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
  if (method === "POST" && path === "/v1/emergency-disable") {
    const body=await readJson(req) as Record<string,unknown>;
    const sessionId=typeof body.sessionId==="string"?body.sessionId:ctx.sessions.listSessions()[0]?.sessionId;
    if(!sessionId||!ctx.sessions.setEmergencyDisabled(sessionId,body.disabled!==false)){sendJson(res,404,{error:{code:"NO_SESSION",message:"Unknown session"}});return;}
    ctx.audit.append({type:"emergency_disable",sessionId,disabled:body.disabled!==false,actor:body.actor??"controller"});
    sendJson(res,200,{ok:true,sessionId,emergencyDisabled:body.disabled!==false}); return;
  }

  sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
}

function handleHealth(ctx: AppContext, res: ServerResponse): void {
  const now = Date.now();
  const sessions = ctx.sessions.listSessions().map((s) => {
    const ageMs = s.lastHeartbeatAt
      ? now - Date.parse(s.lastHeartbeatAt)
      : null;
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
    };
  });
  sendJson(res, 200, {
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    bdsConnected: sessions.some((s) => s.connected),
    sessions,
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
    const draft = {
      ...createEnvelope("action_request", sessionId, newId("req")),
      messageType: "action_request" as const,
      actionId: typeof input.actionId === "string" ? input.actionId : newId("action"),
      idempotencyKey:
        typeof input.idempotencyKey === "string"
          ? input.idempotencyKey
          : newId("idem"),
      toolName: input.toolName,
      arguments:
        typeof input.arguments === "object" && input.arguments !== null
          ? (input.arguments as Record<string, unknown>)
          : {},
      actor: typeof input.actor === "string" ? input.actor : "controller",
      permissionMode: input.permissionMode ?? "confirm_every_change",
      risk: input.risk ?? "read",
      noApprovalReason: "read_risk_no_approval",
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

  const policy={protectedRegions:ctx.config.protectedRegions,builderRegions:ctx.config.builderRegions};
  const classification=classify(action,policy);
  if(classification.risk!==action.risk){ sendJson(res,400,{error:{code:"RISK_MISMATCH",message:`Expected risk ${classification.risk}: ${classification.reason}`}}); return; }
  const denied=enforceMode(action.permissionMode,action,policy);
  if(denied){sendJson(res,403,{error:{code:"POLICY_DENIED",message:denied}});return;}
  const hash=payloadHash(action);
  if(approvalRequired(action.permissionMode,action.risk,action,policy)){
    if(!action.approval){sendJson(res,409,{error:{code:"APPROVAL_REQUIRED",message:"Exact payload approval required"},approval:{payloadHash:hash,risk:action.risk,action}});return;}
    if(action.approval.payloadHash!==hash){sendJson(res,409,{error:{code:"APPROVAL_INVALID",message:"Approval does not match immutable action payload"}});return;}
    if(Date.now()-Date.parse(action.approval.approvedAt)>5*60*1000){sendJson(res,409,{error:{code:"APPROVAL_EXPIRED",message:"Approval is stale"}});return;}
  }
  if(ctx.sessions.isEmergencyDisabled(action.sessionId)&&action.risk!=="read"){sendJson(res,503,{error:{code:"EMERGENCY_DISABLED",message:"Mutations are disabled"}});return;}
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
