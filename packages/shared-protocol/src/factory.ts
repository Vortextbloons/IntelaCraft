import {
  PROTOCOL_VERSION,
  type MessageType,
  type PermissionMode,
  type ReadToolName,
  type RiskClass,
} from "./constants.js";
import type {
  ActionRequestMessage,
  HandshakeMessage,
  HeartbeatMessage,
  MessageEnvelope,
  OperationEventMessage,
  PollMessage,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function createEnvelope(
  messageType: MessageType,
  sessionId: string,
  requestId: string,
  timestamp: string = nowIso(),
): MessageEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageType,
    requestId,
    sessionId,
    timestamp,
  };
}

export function createHandshake(params: {
  sessionId: string;
  requestId: string;
  serverId: string;
  capabilities?: string[];
}): HandshakeMessage {
  return {
    ...createEnvelope("handshake", params.sessionId, params.requestId),
    messageType: "handshake",
    serverId: params.serverId,
    clientProtocolVersion: PROTOCOL_VERSION,
    capabilities: params.capabilities,
  };
}

export function createPoll(params: {
  sessionId: string;
  requestId: string;
}): PollMessage {
  return {
    ...createEnvelope("poll", params.sessionId, params.requestId),
    messageType: "poll",
  };
}

export function createHeartbeat(params: {
  sessionId: string;
  requestId: string;
  serverId: string;
  health: HeartbeatMessage["health"];
}): HeartbeatMessage {
  return {
    ...createEnvelope("heartbeat", params.sessionId, params.requestId),
    messageType: "heartbeat",
    serverId: params.serverId,
    health: params.health,
  };
}

export function createActionRequest(params: {
  sessionId: string;
  requestId: string;
  actionId: string;
  idempotencyKey: string;
  toolName: ReadToolName;
  arguments: Record<string, unknown>;
  actor: string;
  permissionMode?: PermissionMode;
  risk?: RiskClass;
  noApprovalReason?: string;
  expiresAt?: string;
}): ActionRequestMessage {
  const expiresAt =
    params.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString();
  return {
    ...createEnvelope("action_request", params.sessionId, params.requestId),
    messageType: "action_request",
    actionId: params.actionId,
    idempotencyKey: params.idempotencyKey,
    toolName: params.toolName,
    arguments: params.arguments,
    actor: params.actor,
    permissionMode: params.permissionMode ?? "confirm_every_change",
    risk: params.risk ?? "read",
    noApprovalReason: params.noApprovalReason ?? "read_risk_no_approval",
    expiresAt,
  };
}

export function createOperationEvent(params: {
  sessionId: string;
  requestId: string;
  operationId: string;
  actionId: string;
  state: OperationEventMessage["state"];
  completedWork: number;
  totalEstimatedWork: number;
  message: string;
  result?: unknown;
  error?: OperationEventMessage["error"];
}): OperationEventMessage {
  return {
    ...createEnvelope("operation_event", params.sessionId, params.requestId),
    messageType: "operation_event",
    operationId: params.operationId,
    actionId: params.actionId,
    state: params.state,
    completedWork: params.completedWork,
    totalEstimatedWork: params.totalEstimatedWork,
    message: params.message,
    result: params.result,
    error: params.error,
  };
}

let seq = 0;
export function newId(prefix = "id"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}
