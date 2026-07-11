import type { IncomingMessage, ServerResponse } from "node:http";
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
import { readJson, sendJson } from "../http.js";
import { approvalRequired, classify, enforceMode, payloadHash } from "../policy.js";
import type { AppContext } from "./types.js";

export async function handleHandshake(
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

export async function handlePoll(
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

export async function handleBdsEvents(
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

export async function handleHeartbeat(
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

export async function handleEnqueueAction(
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
