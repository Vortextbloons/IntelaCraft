import {
  DIMENSION_IDS,
  MESSAGE_TYPES,
  MUTATION_TOOLS,
  OPERATION_STATES,
  PERMISSION_MODES,
  READ_TOOLS,
  RISK_CLASSES,
  type DimensionId,
  type MessageType,
  type OperationState,
  type PermissionMode,
  type ReadToolName,
  type RiskClass,
  type ToolName,
} from "../constants.js";
import { isNonEmptyString, isProtocolCompatible, isRecord } from "../helpers.js";
import type { ProtocolErrorBody } from "../types.js";

export interface ValidationResult<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  error: ProtocolErrorBody;
}

export type ValidateResult<T> = ValidationResult<T> | ValidationFailure;

export function fail(code: string, message: string, details?: unknown): ValidationFailure {
  return { ok: false, error: { code, message, details } };
}

export function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function asArgs<T extends object>(
  result: ValidateResult<T>,
): ValidateResult<Record<string, unknown>> {
  if (!result.ok) return result;
  return ok(result.value as Record<string, unknown>);
}

export function isMessageType(value: unknown): value is MessageType {
  return typeof value === "string" && (MESSAGE_TYPES as readonly string[]).includes(value);
}

export function isRisk(value: unknown): value is RiskClass {
  return typeof value === "string" && (RISK_CLASSES as readonly string[]).includes(value);
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

export function isOperationState(value: unknown): value is OperationState {
  return typeof value === "string" && (OPERATION_STATES as readonly string[]).includes(value);
}

export function isReadTool(value: unknown): value is ReadToolName {
  return typeof value === "string" && (READ_TOOLS as readonly string[]).includes(value);
}

export function isTool(value: unknown): value is ToolName {
  return isReadTool(value) || (typeof value === "string" && (MUTATION_TOOLS as readonly string[]).includes(value));
}

export function isDimensionId(value: unknown): value is DimensionId {
  return typeof value === "string" && (DIMENSION_IDS as readonly string[]).includes(value);
}

export function validateErrorBody(raw: unknown): ValidateResult<ProtocolErrorBody> {
  if (!isRecord(raw)) return fail("INVALID_ERROR", "error must be an object");
  if (!isNonEmptyString(raw.code)) return fail("INVALID_ERROR", "error.code is required");
  if (!isNonEmptyString(raw.message)) return fail("INVALID_ERROR", "error.message is required");
  return ok({
    code: raw.code,
    message: raw.message,
    details: raw.details,
  });
}

export function validateEnvelope(raw: unknown): ValidateResult<import("../types.js").MessageEnvelope> {
  if (!isRecord(raw)) {
    return fail("INVALID_ENVELOPE", "Message must be an object");
  }
  if (!isNonEmptyString(raw.protocolVersion)) {
    return fail("INVALID_ENVELOPE", "protocolVersion is required");
  }
  if (!isProtocolCompatible(raw.protocolVersion)) {
    return fail(
      "PROTOCOL_INCOMPATIBLE",
      `Incompatible protocolVersion '${raw.protocolVersion}'`,
      { protocolVersion: raw.protocolVersion },
    );
  }
  if (!isMessageType(raw.messageType)) {
    return fail("INVALID_ENVELOPE", "messageType is invalid");
  }
  if (!isNonEmptyString(raw.requestId)) {
    return fail("INVALID_ENVELOPE", "requestId is required");
  }
  if (!isNonEmptyString(raw.sessionId)) {
    return fail("INVALID_ENVELOPE", "sessionId is required");
  }
  if (!isNonEmptyString(raw.timestamp)) {
    return fail("INVALID_ENVELOPE", "timestamp is required");
  }
  if (Number.isNaN(Date.parse(raw.timestamp))) {
    return fail("INVALID_ENVELOPE", "timestamp must be ISO-8601");
  }
  return ok({
    protocolVersion: raw.protocolVersion,
    messageType: raw.messageType,
    requestId: raw.requestId,
    sessionId: raw.sessionId,
    timestamp: raw.timestamp,
  });
}
