import {
  DIMENSION_IDS,
  MESSAGE_TYPES,
  OPERATION_STATES,
  PERMISSION_MODES,
  READ_TOOLS,
  MUTATION_TOOLS,
  MAX_BUILD_VOLUME,
  DEFAULT_BATCH_SIZE,
  RISK_CLASSES,
  type DimensionId,
  type MessageType,
  type OperationState,
  type PermissionMode,
  type ToolName,
  type ReadToolName,
  type RiskClass,
} from "./constants.js";
import {
  isNonEmptyString,
  isProtocolCompatible,
  isRecord,
  parseRegion,
  parseVec3i,
} from "./helpers.js";
import type {
  ActionRequestMessage,
  ErrorMessage,
  HandshakeAckMessage,
  HandshakeMessage,
  HeartbeatMessage,
  InspectBlockArgs,
  InspectPlayersArgs,
  InspectRegionArgs,
  InspectServerStatusArgs,
  InspectWorldStateArgs,
  InspectEntitiesArgs,
  InspectScoreboardArgs,
  InspectTagsArgs,
  AdminRunCommandArgs,
  FillBlocksArgs,
  MessageEnvelope,
  OperationEventMessage,
  PollMessage,
  PollResponseMessage,
  ProtocolErrorBody,
  ProtocolMessage,
} from "./types.js";

export interface ValidationResult<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  error: ProtocolErrorBody;
}

export type ValidateResult<T> = ValidationResult<T> | ValidationFailure;

function fail(code: string, message: string, details?: unknown): ValidationFailure {
  return { ok: false, error: { code, message, details } };
}

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function isMessageType(value: unknown): value is MessageType {
  return typeof value === "string" && (MESSAGE_TYPES as readonly string[]).includes(value);
}

function isRisk(value: unknown): value is RiskClass {
  return typeof value === "string" && (RISK_CLASSES as readonly string[]).includes(value);
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

function isOperationState(value: unknown): value is OperationState {
  return typeof value === "string" && (OPERATION_STATES as readonly string[]).includes(value);
}

function isReadTool(value: unknown): value is ReadToolName {
  return typeof value === "string" && (READ_TOOLS as readonly string[]).includes(value);
}
function isTool(value: unknown): value is ToolName { return isReadTool(value) || (typeof value === "string" && (MUTATION_TOOLS as readonly string[]).includes(value)); }

function isDimensionId(value: unknown): value is DimensionId {
  return typeof value === "string" && (DIMENSION_IDS as readonly string[]).includes(value);
}

export function validateEnvelope(raw: unknown): ValidateResult<MessageEnvelope> {
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

function validateErrorBody(raw: unknown): ValidateResult<ProtocolErrorBody> {
  if (!isRecord(raw)) return fail("INVALID_ERROR", "error must be an object");
  if (!isNonEmptyString(raw.code)) return fail("INVALID_ERROR", "error.code is required");
  if (!isNonEmptyString(raw.message)) return fail("INVALID_ERROR", "error.message is required");
  return ok({
    code: raw.code,
    message: raw.message,
    details: raw.details,
  });
}

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
  if (isReadTool(raw.toolName) && raw.risk !== "read") return fail("INVALID_RISK", "Inspection tools require read risk");
  if (!isReadTool(raw.toolName) && !["normal", "strong"].includes(raw.risk)) return fail("INVALID_RISK", "Mutation requires normal or strong risk");
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

export function validateToolArguments(
  toolName: ToolName,
  args: Record<string, unknown>,
): ValidateResult<Record<string, unknown>> {
  switch (toolName) {
    case "inspect.server_status":
      return asArgs(validateInspectServerStatus(args));
    case "inspect.players":
      return asArgs(validateInspectPlayers(args));
    case "inspect.block":
      return asArgs(validateInspectBlock(args));
    case "inspect.region":
      return asArgs(validateInspectRegion(args));
    case "inspect.world_state":
      return asArgs(validateInspectWorldState(args));
    case "inspect.entities":
      return asArgs(validateInspectEntities(args));
    case "inspect.scoreboard":
      return asArgs(validateInspectScoreboard(args));
    case "inspect.tags":
      return asArgs(validateInspectTags(args));
    case "world.fill_blocks":
      return asArgs(validateFillBlocks(args));
    case "control.cancel":
      if(!isNonEmptyString(args.actionId)) return fail("INVALID_ARGS","actionId is required");
      return ok({actionId:args.actionId});
    case "control.emergency_disable":
      if(typeof args.disabled!=="boolean") return fail("INVALID_ARGS","disabled must be boolean");
      return ok({disabled:args.disabled});
    case "admin.run_command":
      return asArgs(validateAdminRunCommand(args));
    default:
      return fail("UNKNOWN_TOOL", `Unknown tool '${toolName}'`);
  }
}

function validateFillBlocks(args: Record<string, unknown>): ValidateResult<FillBlocksArgs> {
  if (!isDimensionId(args.dimension)) return fail("INVALID_ARGS", "dimension is required");
  const region = parseRegion(args.region);
  if (!region) return fail("INVALID_ARGS", "region must include min/max integer corners");
  const volume = (region.max.x-region.min.x+1)*(region.max.y-region.min.y+1)*(region.max.z-region.min.z+1);
  if (volume > MAX_BUILD_VOLUME) return fail("REGION_TOO_LARGE", `Build volume ${volume} exceeds max ${MAX_BUILD_VOLUME}`);
  if (!isNonEmptyString(args.blockType) || !/^minecraft:[a-z0-9_.-]+$/.test(args.blockType)) return fail("INVALID_ARGS", "blockType must be a namespaced Minecraft block id");
  const batchSize = args.batchSize === undefined ? DEFAULT_BATCH_SIZE : args.batchSize;
  if (!Number.isInteger(batchSize) || (batchSize as number) < 1 || (batchSize as number) > DEFAULT_BATCH_SIZE) return fail("INVALID_ARGS", `batchSize must be 1-${DEFAULT_BATCH_SIZE}`);
  return ok({ dimension: args.dimension, region, blockType: args.blockType, batchSize: batchSize as number, captureRollback: args.captureRollback === true });
}

function asArgs<T extends object>(result: ValidateResult<T>): ValidateResult<Record<string, unknown>> {
  if (!result.ok) return result;
  return ok(result.value as Record<string, unknown>);
}

function validateInspectServerStatus(
  args: Record<string, unknown>,
): ValidateResult<InspectServerStatusArgs> {
  const includeDimensions =
    args.includeDimensions === undefined ? undefined : Boolean(args.includeDimensions);
  return ok({ includeDimensions });
}

function validateInspectPlayers(
  args: Record<string, unknown>,
): ValidateResult<InspectPlayersArgs> {
  if (args.nameFilter !== undefined && typeof args.nameFilter !== "string") {
    return fail("INVALID_ARGS", "nameFilter must be a string");
  }
  return ok({
    nameFilter: typeof args.nameFilter === "string" ? args.nameFilter : undefined,
  });
}

function validateInspectBlock(args: Record<string, unknown>): ValidateResult<InspectBlockArgs> {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  const position = parseVec3i(args.position);
  if (!position) return fail("INVALID_ARGS", "position must be integer x,y,z");
  return ok({ dimension: args.dimension, position });
}

function validateInspectRegion(args: Record<string, unknown>): ValidateResult<InspectRegionArgs> {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  const region = parseRegion(args.region);
  if (!region) return fail("INVALID_ARGS", "region must include min/max integer corners");
  return ok({
    dimension: args.dimension,
    region,
    countsOnly: args.countsOnly === undefined ? true : Boolean(args.countsOnly),
  });
}

function validateInspectWorldState(
  args: Record<string, unknown>,
): ValidateResult<InspectWorldStateArgs> {
  if (args.dimension !== undefined && !isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is invalid");
  }
  if (args.rules !== undefined) {
    if (!Array.isArray(args.rules) || !args.rules.every((n) => typeof n === "string")) {
      return fail("INVALID_ARGS", "rules must be a string array");
    }
    return ok({
      dimension: isDimensionId(args.dimension) ? args.dimension : undefined,
      rules: args.rules as string[],
    });
  }
  return ok({
    dimension: isDimensionId(args.dimension) ? args.dimension : undefined,
  });
}

function validateInspectEntities(
  args: Record<string, unknown>,
): ValidateResult<InspectEntitiesArgs> {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  if (args.typeFilter !== undefined && typeof args.typeFilter !== "string") {
    return fail("INVALID_ARGS", "typeFilter must be a string");
  }
  const limit = args.limit === undefined ? 64 : args.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 128) {
    return fail("INVALID_ARGS", "limit must be an integer 1-128");
  }
  return ok({
    dimension: args.dimension,
    typeFilter: typeof args.typeFilter === "string" ? args.typeFilter : undefined,
    limit: limit as number,
  });
}

function validateInspectScoreboard(
  args: Record<string, unknown>,
): ValidateResult<InspectScoreboardArgs> {
  if (args.objective !== undefined && typeof args.objective !== "string") {
    return fail("INVALID_ARGS", "objective must be a string");
  }
  return ok({
    objective: typeof args.objective === "string" ? args.objective : undefined,
  });
}

function validateInspectTags(args: Record<string, unknown>): ValidateResult<InspectTagsArgs> {
  if (!isNonEmptyString(args.target)) {
    return fail("INVALID_ARGS", "target is required");
  }
  return ok({
    target: args.target,
    player: args.player === undefined ? true : Boolean(args.player),
  });
}

function validateAdminRunCommand(
  args: Record<string, unknown>,
): ValidateResult<AdminRunCommandArgs> {
  if (!isNonEmptyString(args.commandId)) {
    return fail("INVALID_ARGS", "commandId is required");
  }
  if (args.command !== undefined && typeof args.command !== "string") {
    return fail("INVALID_ARGS", "command must be a string when present");
  }
  return ok({
    commandId: args.commandId,
    command: typeof args.command === "string" ? args.command : undefined,
  });
}
