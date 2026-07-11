import { isRecord, isNonEmptyString, isProtocolCompatible } from "../helpers.js";
import type {
  ActionRequestMessage,
  ErrorMessage,
  HandshakeAckMessage,
  HandshakeMessage,
  HeartbeatMessage,
  MessageEnvelope,
  OperationEventMessage,
  PollMessage,
  PollResponseMessage,
  ProtocolErrorBody,
  ProtocolMessage,
} from "../types.js";
import {
  fail,
  isMessageType,
  isOperationState,
  isPermissionMode,
  isReadTool,
  isRisk,
  isTool,
  ok,
  validateEnvelope,
  validateErrorBody,
  type ValidateResult,
} from "./common.js";
import { validateToolArguments } from "./tools.js";

export function validateHandshake(raw: unknown): ValidateResult<HandshakeMessage> {
  const env = validateEnvelope(raw);
  if (!env.ok) return env;
  if (env.value.messageType !== "handshake") {
    return fail("INVALID_MESSAGE", "Expected handshake");
  }
  if (!isRecord(raw)) return fail("INVALID_MESSAGE", "Invalid handshake");
  if (!isNonEmptyString(raw.serverId)) {
    return fail("INVALID_HANDSHAKE", "serverId is required");
  }
  if (!isNonEmptyString(raw.clientProtocolVersion)) {
    return fail("INVALID_HANDSHAKE", "clientProtocolVersion is required");
  }
  if (!isProtocolCompatible(raw.clientProtocolVersion)) {
    return fail(
      "PROTOCOL_INCOMPATIBLE",
      `Incompatible clientProtocolVersion '${raw.clientProtocolVersion}'`,
    );
  }
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((c): c is string => typeof c === "string")
    : undefined;
  return ok({
    ...env.value,
    messageType: "handshake",
    serverId: raw.serverId,
    clientProtocolVersion: raw.clientProtocolVersion,
    capabilities,
  });
}

export function validateHandshakeAck(raw: unknown): ValidateResult<HandshakeAckMessage> {
  const env = validateEnvelope(raw);
  if (!env.ok) return env;
  if (env.value.messageType !== "handshake_ack") {
    return fail("INVALID_MESSAGE", "Expected handshake_ack");
  }
  if (!isRecord(raw)) return fail("INVALID_MESSAGE", "Invalid handshake_ack");
  if (!isNonEmptyString(raw.acceptedProtocolVersion)) {
    return fail("INVALID_HANDSHAKE_ACK", "acceptedProtocolVersion is required");
  }
  if (!isNonEmptyString(raw.serverId)) {
    return fail("INVALID_HANDSHAKE_ACK", "serverId is required");
  }
  if (typeof raw.ok !== "boolean") {
    return fail("INVALID_HANDSHAKE_ACK", "ok must be boolean");
  }
  let error: ProtocolErrorBody | undefined;
  if (raw.error !== undefined) {
    const err = validateErrorBody(raw.error);
    if (!err.ok) return err;
    error = err.value;
  }
  return ok({
    ...env.value,
    messageType: "handshake_ack",
    acceptedProtocolVersion: raw.acceptedProtocolVersion,
    serverId: raw.serverId,
    ok: raw.ok,
    error,
  });
}

export function validatePoll(raw: unknown): ValidateResult<PollMessage> {
  const env = validateEnvelope(raw);
  if (!env.ok) return env;
  if (env.value.messageType !== "poll") {
    return fail("INVALID_MESSAGE", "Expected poll");
  }
  return ok({ ...env.value, messageType: "poll" });
}

export function validateActionRequest(raw: unknown): ValidateResult<ActionRequestMessage> {
  const env = validateEnvelope(raw);
  if (!env.ok) return env;
  if (env.value.messageType !== "action_request") {
    return fail("INVALID_MESSAGE", "Expected action_request");
  }
  if (!isRecord(raw)) return fail("INVALID_MESSAGE", "Invalid action_request");
  if (!isNonEmptyString(raw.actionId)) {
    return fail("INVALID_ACTION", "actionId is required");
  }
  if (!isNonEmptyString(raw.idempotencyKey)) {
    return fail("INVALID_ACTION", "idempotencyKey is required");
  }
  if (!isTool(raw.toolName)) {
    return fail("UNKNOWN_TOOL", `Unknown or unsupported tool '${String(raw.toolName)}'`);
  }
  if (!isRecord(raw.arguments)) {
    return fail("INVALID_ACTION", "arguments must be an object");
  }
  const argsCheck = validateToolArguments(raw.toolName, raw.arguments);
  if (!argsCheck.ok) return argsCheck;
  if (!isNonEmptyString(raw.actor)) {
    return fail("INVALID_ACTION", "actor is required");
  }
  if (!isPermissionMode(raw.permissionMode)) {
    return fail("INVALID_ACTION", "permissionMode is invalid");
  }
  if (!isRisk(raw.risk)) {
    return fail("INVALID_ACTION", "risk is invalid");
  }
  if (isReadTool(raw.toolName) && raw.risk !== "read") {
    return fail("INVALID_RISK", "Inspection tools require read risk");
  }
  if (!isReadTool(raw.toolName) && !["normal", "strong"].includes(raw.risk)) {
    return fail("INVALID_RISK", "Mutation requires normal or strong risk");
  }
  if (!isNonEmptyString(raw.expiresAt) || Number.isNaN(Date.parse(raw.expiresAt))) {
    return fail("INVALID_ACTION", "expiresAt must be ISO-8601");
  }
  if (raw.approval === undefined && !isNonEmptyString(raw.noApprovalReason)) {
    return fail("INVALID_ACTION", "approval or noApprovalReason is required");
  }
  let approval: ActionRequestMessage["approval"];
  if (raw.approval !== undefined) {
    if (!isRecord(raw.approval)) {
      return fail("INVALID_ACTION", "approval must be an object");
    }
    if (
      !isNonEmptyString(raw.approval.approvalId) ||
      !isNonEmptyString(raw.approval.approvedAt) ||
      !isNonEmptyString(raw.approval.approvedBy) ||
      !isNonEmptyString(raw.approval.payloadHash)
    ) {
      return fail("INVALID_ACTION", "approval fields are incomplete");
    }
    approval = {
      approvalId: raw.approval.approvalId,
      approvedAt: raw.approval.approvedAt,
      approvedBy: raw.approval.approvedBy,
      payloadHash: raw.approval.payloadHash,
    };
  }
  return ok({
    ...env.value,
    messageType: "action_request",
    actionId: raw.actionId,
    idempotencyKey: raw.idempotencyKey,
    toolName: raw.toolName,
    arguments: argsCheck.value,
    actor: raw.actor,
    permissionMode: raw.permissionMode,
    risk: raw.risk,
    approval,
    noApprovalReason:
      typeof raw.noApprovalReason === "string" ? raw.noApprovalReason : undefined,
    expiresAt: raw.expiresAt,
  });
}

export function validatePollResponse(raw: unknown): ValidateResult<PollResponseMessage> {
  const env = validateEnvelope(raw);
  if (!env.ok) return env;
  if (env.value.messageType !== "poll_response") {
    return fail("INVALID_MESSAGE", "Expected poll_response");
  }
  if (!isRecord(raw)) return fail("INVALID_MESSAGE", "Invalid poll_response");
  if (raw.action === null) {
    return ok({ ...env.value, messageType: "poll_response", action: null });
  }
  const action = validateActionRequest(raw.action);
  if (!action.ok) return action;
  return ok({ ...env.value, messageType: "poll_response", action: action.value });
}

export function validateOperationEvent(raw: unknown): ValidateResult<OperationEventMessage> {
  const env = validateEnvelope(raw);
  if (!env.ok) return env;
  if (env.value.messageType !== "operation_event") {
    return fail("INVALID_MESSAGE", "Expected operation_event");
  }
  if (!isRecord(raw)) return fail("INVALID_MESSAGE", "Invalid operation_event");
  if (!isNonEmptyString(raw.operationId)) {
    return fail("INVALID_EVENT", "operationId is required");
  }
  if (!isNonEmptyString(raw.actionId)) {
    return fail("INVALID_EVENT", "actionId is required");
  }
  if (!isOperationState(raw.state)) {
    return fail("INVALID_EVENT", "state is invalid");
  }
  if (typeof raw.completedWork !== "number" || !Number.isFinite(raw.completedWork)) {
    return fail("INVALID_EVENT", "completedWork must be a number");
  }
  if (typeof raw.totalEstimatedWork !== "number" || !Number.isFinite(raw.totalEstimatedWork)) {
    return fail("INVALID_EVENT", "totalEstimatedWork must be a number");
  }
  if (typeof raw.message !== "string") {
    return fail("INVALID_EVENT", "message must be a string");
  }
  let error: ProtocolErrorBody | undefined;
  if (raw.error !== undefined) {
    const err = validateErrorBody(raw.error);
    if (!err.ok) return err;
    error = err.value;
  }
  return ok({
    ...env.value,
    messageType: "operation_event",
    operationId: raw.operationId,
    actionId: raw.actionId,
    state: raw.state,
    completedWork: raw.completedWork,
    totalEstimatedWork: raw.totalEstimatedWork,
    message: raw.message,
    result: raw.result,
    error,
  });
}

export function validateHeartbeat(raw: unknown): ValidateResult<HeartbeatMessage> {
  const env = validateEnvelope(raw);
  if (!env.ok) return env;
  if (env.value.messageType !== "heartbeat") {
    return fail("INVALID_MESSAGE", "Expected heartbeat");
  }
  if (!isRecord(raw)) return fail("INVALID_MESSAGE", "Invalid heartbeat");
  if (!isNonEmptyString(raw.serverId)) {
    return fail("INVALID_HEARTBEAT", "serverId is required");
  }
  if (!isRecord(raw.health)) {
    return fail("INVALID_HEARTBEAT", "health is required");
  }
  if (typeof raw.health.ok !== "boolean") {
    return fail("INVALID_HEARTBEAT", "health.ok must be boolean");
  }
  if (typeof raw.health.playerCount !== "number" || !Number.isFinite(raw.health.playerCount)) {
    return fail("INVALID_HEARTBEAT", "health.playerCount must be a number");
  }
  return ok({
    ...env.value,
    messageType: "heartbeat",
    serverId: raw.serverId,
    health: {
      ok: raw.health.ok,
      playerCount: raw.health.playerCount,
      tick: typeof raw.health.tick === "number" ? raw.health.tick : undefined,
      emergencyDisabled:
        typeof raw.health.emergencyDisabled === "boolean"
          ? raw.health.emergencyDisabled
          : undefined,
    },
  });
}

export function validateErrorMessage(raw: unknown): ValidateResult<ErrorMessage> {
  const env = validateEnvelope(raw);
  if (!env.ok) return env;
  if (env.value.messageType !== "error") {
    return fail("INVALID_MESSAGE", "Expected error");
  }
  if (!isRecord(raw)) return fail("INVALID_MESSAGE", "Invalid error message");
  const err = validateErrorBody(raw.error);
  if (!err.ok) return err;
  return ok({ ...env.value, messageType: "error", error: err.value });
}

export function validateProtocolMessage(raw: unknown): ValidateResult<ProtocolMessage> {
  if (!isRecord(raw) || !isMessageType(raw.messageType)) {
    return fail("INVALID_MESSAGE", "Unrecognized message");
  }
  switch (raw.messageType) {
    case "handshake":
      return validateHandshake(raw);
    case "handshake_ack":
      return validateHandshakeAck(raw);
    case "poll":
      return validatePoll(raw);
    case "poll_response":
      return validatePollResponse(raw);
    case "action_request":
      return validateActionRequest(raw);
    case "operation_event":
      return validateOperationEvent(raw);
    case "heartbeat":
      return validateHeartbeat(raw);
    case "error":
      return validateErrorMessage(raw);
    default:
      return fail("INVALID_MESSAGE", "Unrecognized messageType");
  }
}

export type { MessageEnvelope };
