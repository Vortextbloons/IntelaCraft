// src/main.ts
import { system as system3 } from "@minecraft/server";

// src/audit/notify.ts
import { PlayerPermissionLevel, world } from "@minecraft/server";
function notifyOperators(message) {
  try {
    for (const player of world.getPlayers()) {
      if (player.playerPermissionLevel === PlayerPermissionLevel.Operator) {
        player.sendMessage(`\xA77[IntelaCraft]\xA7r ${message}`);
      }
    }
  } catch {
  }
  console.warn(`[IntelaCraft] ${message}`);
}

// src/config.ts
import { secrets, variables } from "@minecraft/server-admin";
var CONTROLLER_URL_VAR = "intelacraft:controller_url";
var BDS_TOKEN_SECRET = "intelacraft:bds_token";
var SERVER_ID_VAR = "intelacraft:server_id";
var PROTECTED_REGIONS_VAR = "intelacraft:protected_regions";
var ADMIN_COMMANDS_VAR = "intelacraft:admin_commands";
function loadConfig() {
  const missing = [];
  const controllerUrlRaw = variables.get(CONTROLLER_URL_VAR);
  const controllerUrl = typeof controllerUrlRaw === "string" ? controllerUrlRaw.trim().replace(/\/$/, "") : "";
  if (!controllerUrl) missing.push(CONTROLLER_URL_VAR);
  const authToken = secrets.get(BDS_TOKEN_SECRET);
  if (!authToken) missing.push(BDS_TOKEN_SECRET);
  const serverIdRaw = variables.get(SERVER_ID_VAR);
  const serverId = typeof serverIdRaw === "string" && serverIdRaw.trim().length > 0 ? serverIdRaw.trim() : "bds-default";
  const protectedRaw = variables.get(PROTECTED_REGIONS_VAR);
  let protectedRegions = [];
  if (typeof protectedRaw === "string" && protectedRaw.trim()) {
    try {
      const parsed = JSON.parse(protectedRaw);
      if (Array.isArray(parsed)) protectedRegions = parsed;
    } catch {
      missing.push(`${PROTECTED_REGIONS_VAR} (invalid JSON)`);
    }
  }
  const adminRaw = variables.get(ADMIN_COMMANDS_VAR);
  let adminCommands = {};
  if (typeof adminRaw === "string" && adminRaw.trim()) {
    try {
      const parsed = JSON.parse(adminRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) adminCommands = parsed;
    } catch {
      missing.push(`${ADMIN_COMMANDS_VAR} (invalid JSON)`);
    }
  }
  return {
    controllerUrl,
    authToken,
    serverId,
    configured: missing.length === 0,
    missing,
    protectedRegions,
    adminCommands
  };
}

// src/net/session.ts
import { system as system2, world as world4 } from "@minecraft/server";

// ../../packages/shared-protocol/src/constants.ts
var PROTOCOL_VERSION = "1.0.0";
var PROTOCOL_MAJOR = 1;
var MAX_REGION_VOLUME = 32 * 32 * 32;
var MAX_BUILD_VOLUME = 32 * 32 * 32;
var DEFAULT_BATCH_SIZE = 512;
var MAX_ROLLBACK_BLOCKS = 8192;
var MESSAGE_TYPES = [
  "handshake",
  "handshake_ack",
  "poll",
  "poll_response",
  "action_request",
  "operation_event",
  "heartbeat",
  "error"
];
var RISK_CLASSES = ["read", "normal", "strong", "prohibited"];
var PERMISSION_MODES = [
  "observe_only",
  "confirm_every_change",
  "allow_low_risk",
  "builder_region",
  "trusted_administrator"
];
var READ_TOOLS = [
  "inspect.server_status",
  "inspect.players",
  "inspect.block",
  "inspect.region",
  "inspect.time",
  "inspect.weather",
  "inspect.game_rules",
  "inspect.entities",
  "inspect.scoreboard",
  "inspect.tags"
];
var MUTATION_TOOLS = [
  "world.fill_blocks",
  "control.cancel",
  "control.emergency_disable",
  "admin.run_command"
];
var DIMENSION_IDS = [
  "minecraft:overworld",
  "minecraft:nether",
  "minecraft:the_end"
];

// ../../packages/shared-protocol/src/helpers.ts
function parseProtocolVersion(version) {
  if (typeof version !== "string") return null;
  const parts = version.trim().split(".");
  if (parts.length !== 3) return null;
  const [major, minor, patch] = parts.map((p) => Number(p));
  if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0)) {
    return null;
  }
  return { major, minor, patch };
}
function isProtocolCompatible(clientVersion) {
  const parsed = parseProtocolVersion(clientVersion);
  if (!parsed) return false;
  return parsed.major === PROTOCOL_MAJOR;
}
function isInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseVec3i(value) {
  if (!isRecord(value)) return null;
  if (!isInteger(value.x) || !isInteger(value.y) || !isInteger(value.z)) return null;
  return { x: value.x, y: value.y, z: value.z };
}
function normalizeRegion(a, b) {
  return {
    min: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      z: Math.min(a.z, b.z)
    },
    max: {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      z: Math.max(a.z, b.z)
    }
  };
}
function parseRegion(value) {
  if (!isRecord(value)) return null;
  if (value.min !== void 0 && value.max !== void 0) {
    const min = parseVec3i(value.min);
    const max = parseVec3i(value.max);
    if (!min || !max) return null;
    return normalizeRegion(min, max);
  }
  if (value.from !== void 0 && value.to !== void 0) {
    const from = parseVec3i(value.from);
    const to = parseVec3i(value.to);
    if (!from || !to) return null;
    return normalizeRegion(from, to);
  }
  return null;
}
function regionVolume(region) {
  const dx = region.max.x - region.min.x + 1;
  const dy = region.max.y - region.min.y + 1;
  const dz = region.max.z - region.min.z + 1;
  return dx * dy * dz;
}
function isExpired(expiresAt, now = /* @__PURE__ */ new Date()) {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}
function createIdempotencyTracker(maxEntries = 2048) {
  const seen = /* @__PURE__ */ new Map();
  return {
    /** Returns true if this key was already seen (duplicate). */
    checkAndRemember(key, nowMs = Date.now()) {
      if (seen.has(key)) return true;
      seen.set(key, nowMs);
      if (seen.size > maxEntries) {
        const oldest = seen.keys().next().value;
        if (oldest !== void 0) seen.delete(oldest);
      }
      return false;
    },
    has(key) {
      return seen.has(key);
    },
    clear() {
      seen.clear();
    }
  };
}

// ../../packages/shared-protocol/src/validate.ts
function fail(code, message, details) {
  return { ok: false, error: { code, message, details } };
}
function ok(value) {
  return { ok: true, value };
}
function isMessageType(value) {
  return typeof value === "string" && MESSAGE_TYPES.includes(value);
}
function isRisk(value) {
  return typeof value === "string" && RISK_CLASSES.includes(value);
}
function isPermissionMode(value) {
  return typeof value === "string" && PERMISSION_MODES.includes(value);
}
function isReadTool(value) {
  return typeof value === "string" && READ_TOOLS.includes(value);
}
function isTool(value) {
  return isReadTool(value) || typeof value === "string" && MUTATION_TOOLS.includes(value);
}
function isDimensionId(value) {
  return typeof value === "string" && DIMENSION_IDS.includes(value);
}
function validateEnvelope(raw) {
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
      { protocolVersion: raw.protocolVersion }
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
    timestamp: raw.timestamp
  });
}
function validateErrorBody(raw) {
  if (!isRecord(raw)) return fail("INVALID_ERROR", "error must be an object");
  if (!isNonEmptyString(raw.code)) return fail("INVALID_ERROR", "error.code is required");
  if (!isNonEmptyString(raw.message)) return fail("INVALID_ERROR", "error.message is required");
  return ok({
    code: raw.code,
    message: raw.message,
    details: raw.details
  });
}
function validateHandshakeAck(raw) {
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
  let error;
  if (raw.error !== void 0) {
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
    error
  });
}
function validateActionRequest(raw) {
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
  if (raw.approval === void 0 && !isNonEmptyString(raw.noApprovalReason)) {
    return fail("INVALID_ACTION", "approval or noApprovalReason is required");
  }
  let approval;
  if (raw.approval !== void 0) {
    if (!isRecord(raw.approval)) {
      return fail("INVALID_ACTION", "approval must be an object");
    }
    if (!isNonEmptyString(raw.approval.approvalId) || !isNonEmptyString(raw.approval.approvedAt) || !isNonEmptyString(raw.approval.approvedBy) || !isNonEmptyString(raw.approval.payloadHash)) {
      return fail("INVALID_ACTION", "approval fields are incomplete");
    }
    approval = {
      approvalId: raw.approval.approvalId,
      approvedAt: raw.approval.approvedAt,
      approvedBy: raw.approval.approvedBy,
      payloadHash: raw.approval.payloadHash
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
    noApprovalReason: typeof raw.noApprovalReason === "string" ? raw.noApprovalReason : void 0,
    expiresAt: raw.expiresAt
  });
}
function validatePollResponse(raw) {
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
function validateToolArguments(toolName, args) {
  switch (toolName) {
    case "inspect.server_status":
      return asArgs(validateInspectServerStatus(args));
    case "inspect.players":
      return asArgs(validateInspectPlayers(args));
    case "inspect.block":
      return asArgs(validateInspectBlock(args));
    case "inspect.region":
      return asArgs(validateInspectRegion(args));
    case "inspect.time":
      return asArgs(validateInspectTime(args));
    case "inspect.weather":
      return asArgs(validateInspectWeather(args));
    case "inspect.game_rules":
      return asArgs(validateInspectGameRules(args));
    case "inspect.entities":
      return asArgs(validateInspectEntities(args));
    case "inspect.scoreboard":
      return asArgs(validateInspectScoreboard(args));
    case "inspect.tags":
      return asArgs(validateInspectTags(args));
    case "world.fill_blocks":
      return asArgs(validateFillBlocks(args));
    case "control.cancel":
      if (!isNonEmptyString(args.actionId)) return fail("INVALID_ARGS", "actionId is required");
      return ok({ actionId: args.actionId });
    case "control.emergency_disable":
      if (typeof args.disabled !== "boolean") return fail("INVALID_ARGS", "disabled must be boolean");
      return ok({ disabled: args.disabled });
    case "admin.run_command":
      return asArgs(validateAdminRunCommand(args));
    default:
      return fail("UNKNOWN_TOOL", `Unknown tool '${toolName}'`);
  }
}
function validateFillBlocks(args) {
  if (!isDimensionId(args.dimension)) return fail("INVALID_ARGS", "dimension is required");
  const region = parseRegion(args.region);
  if (!region) return fail("INVALID_ARGS", "region must include min/max integer corners");
  const volume = (region.max.x - region.min.x + 1) * (region.max.y - region.min.y + 1) * (region.max.z - region.min.z + 1);
  if (volume > MAX_BUILD_VOLUME) return fail("REGION_TOO_LARGE", `Build volume ${volume} exceeds max ${MAX_BUILD_VOLUME}`);
  if (!isNonEmptyString(args.blockType) || !/^minecraft:[a-z0-9_.-]+$/.test(args.blockType)) return fail("INVALID_ARGS", "blockType must be a namespaced Minecraft block id");
  const batchSize = args.batchSize === void 0 ? DEFAULT_BATCH_SIZE : args.batchSize;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > DEFAULT_BATCH_SIZE) return fail("INVALID_ARGS", `batchSize must be 1-${DEFAULT_BATCH_SIZE}`);
  return ok({ dimension: args.dimension, region, blockType: args.blockType, batchSize, captureRollback: args.captureRollback === true });
}
function asArgs(result) {
  if (!result.ok) return result;
  return ok(result.value);
}
function validateInspectServerStatus(args) {
  const includeDimensions = args.includeDimensions === void 0 ? void 0 : Boolean(args.includeDimensions);
  return ok({ includeDimensions });
}
function validateInspectPlayers(args) {
  if (args.nameFilter !== void 0 && typeof args.nameFilter !== "string") {
    return fail("INVALID_ARGS", "nameFilter must be a string");
  }
  return ok({
    nameFilter: typeof args.nameFilter === "string" ? args.nameFilter : void 0
  });
}
function validateInspectBlock(args) {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  const position = parseVec3i(args.position);
  if (!position) return fail("INVALID_ARGS", "position must be integer x,y,z");
  return ok({ dimension: args.dimension, position });
}
function validateInspectRegion(args) {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  const region = parseRegion(args.region);
  if (!region) return fail("INVALID_ARGS", "region must include min/max integer corners");
  return ok({
    dimension: args.dimension,
    region,
    countsOnly: args.countsOnly === void 0 ? true : Boolean(args.countsOnly)
  });
}
function validateInspectTime(args) {
  if (args.dimension !== void 0 && !isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is invalid");
  }
  return ok({
    dimension: isDimensionId(args.dimension) ? args.dimension : void 0
  });
}
function validateInspectWeather(args) {
  if (args.dimension !== void 0 && !isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is invalid");
  }
  return ok({
    dimension: isDimensionId(args.dimension) ? args.dimension : void 0
  });
}
function validateInspectGameRules(args) {
  if (args.names !== void 0) {
    if (!Array.isArray(args.names) || !args.names.every((n) => typeof n === "string")) {
      return fail("INVALID_ARGS", "names must be a string array");
    }
    return ok({ names: args.names });
  }
  return ok({});
}
function validateInspectEntities(args) {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  if (args.typeFilter !== void 0 && typeof args.typeFilter !== "string") {
    return fail("INVALID_ARGS", "typeFilter must be a string");
  }
  const limit = args.limit === void 0 ? 64 : args.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) {
    return fail("INVALID_ARGS", "limit must be an integer 1-128");
  }
  return ok({
    dimension: args.dimension,
    typeFilter: typeof args.typeFilter === "string" ? args.typeFilter : void 0,
    limit
  });
}
function validateInspectScoreboard(args) {
  if (args.objective !== void 0 && typeof args.objective !== "string") {
    return fail("INVALID_ARGS", "objective must be a string");
  }
  return ok({
    objective: typeof args.objective === "string" ? args.objective : void 0
  });
}
function validateInspectTags(args) {
  if (!isNonEmptyString(args.target)) {
    return fail("INVALID_ARGS", "target is required");
  }
  return ok({
    target: args.target,
    player: args.player === void 0 ? true : Boolean(args.player)
  });
}
function validateAdminRunCommand(args) {
  if (!isNonEmptyString(args.commandId)) {
    return fail("INVALID_ARGS", "commandId is required");
  }
  if (args.command !== void 0 && typeof args.command !== "string") {
    return fail("INVALID_ARGS", "command must be a string when present");
  }
  return ok({
    commandId: args.commandId,
    command: typeof args.command === "string" ? args.command : void 0
  });
}

// ../../packages/shared-protocol/src/factory.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function createEnvelope(messageType, sessionId, requestId, timestamp = nowIso()) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageType,
    requestId,
    sessionId,
    timestamp
  };
}
function createHandshake(params) {
  return {
    ...createEnvelope("handshake", params.sessionId, params.requestId),
    messageType: "handshake",
    serverId: params.serverId,
    clientProtocolVersion: PROTOCOL_VERSION,
    capabilities: params.capabilities
  };
}
function createPoll(params) {
  return {
    ...createEnvelope("poll", params.sessionId, params.requestId),
    messageType: "poll"
  };
}
function createHeartbeat(params) {
  return {
    ...createEnvelope("heartbeat", params.sessionId, params.requestId),
    messageType: "heartbeat",
    serverId: params.serverId,
    health: params.health
  };
}
function createOperationEvent(params) {
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
    error: params.error
  };
}
var seq = 0;
function newId(prefix = "id") {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

// src/tools/inspect/index.ts
import { PlayerPermissionLevel as PlayerPermissionLevel2, world as world2 } from "@minecraft/server";
var DEFAULT_GAME_RULE_KEYS = [
  "doDayLightCycle",
  "doMobSpawning",
  "doWeatherCycle",
  "keepInventory",
  "mobGriefing",
  "pvp",
  "showCoordinates",
  "tntExplodes"
];
function getDimension(id) {
  return world2.getDimension(id);
}
function executeInspectTool(action) {
  const toolName = action.toolName;
  try {
    switch (toolName) {
      case "inspect.server_status":
        return inspectServerStatus(action.arguments);
      case "inspect.players":
        return inspectPlayers(action.arguments);
      case "inspect.block":
        return inspectBlock(action.arguments);
      case "inspect.region":
        return inspectRegion(action.arguments);
      case "inspect.time":
        return inspectTime(action.arguments);
      case "inspect.weather":
        return inspectWeather(action.arguments);
      case "inspect.game_rules":
        return inspectGameRules(action.arguments);
      case "inspect.entities":
        return inspectEntities(action.arguments);
      case "inspect.scoreboard":
        return inspectScoreboard(action.arguments);
      case "inspect.tags":
        return inspectTags(action.arguments);
      default:
        return {
          ok: false,
          code: "UNKNOWN_TOOL",
          message: `Unsupported tool '${action.toolName}'`
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    return { ok: false, code: "TOOL_ERROR", message };
  }
}
function inspectServerStatus(args) {
  const players = world2.getPlayers();
  const result = {
    playerCount: players.length,
    players: players.map((p) => p.name)
  };
  if (args.includeDimensions) {
    result.dimensions = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
  }
  return {
    ok: true,
    result,
    completedWork: 1,
    totalEstimatedWork: 1,
    message: "Server status collected"
  };
}
function inspectPlayers(args) {
  const filter = args.nameFilter?.toLowerCase();
  const players = world2.getPlayers().filter((p) => {
    if (!filter) return true;
    return p.name.toLowerCase().includes(filter);
  });
  return {
    ok: true,
    result: {
      count: players.length,
      players: players.map((p) => {
        const loc = p.location;
        return {
          name: p.name,
          id: p.id,
          dimension: p.dimension.id,
          location: {
            x: Math.floor(loc.x),
            y: Math.floor(loc.y),
            z: Math.floor(loc.z)
          },
          permissionLevel: p.playerPermissionLevel,
          isOperator: p.playerPermissionLevel === PlayerPermissionLevel2.Operator
        };
      })
    },
    completedWork: players.length,
    totalEstimatedWork: players.length,
    message: `Found ${players.length} player(s)`
  };
}
function inspectBlock(args) {
  const dimension = getDimension(args.dimension);
  const block = dimension.getBlock(args.position);
  if (!block || !block.isValid) {
    return {
      ok: false,
      code: "BLOCK_UNAVAILABLE",
      message: "Block is unloaded or out of world",
      details: { dimension: args.dimension, position: args.position }
    };
  }
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      position: { x: block.x, y: block.y, z: block.z },
      typeId: block.typeId,
      isAir: block.isAir,
      isLiquid: block.isLiquid,
      isWaterlogged: block.isWaterlogged
    },
    completedWork: 1,
    totalEstimatedWork: 1,
    message: `Block ${block.typeId}`
  };
}
function inspectRegion(args) {
  const volume = regionVolume(args.region);
  if (volume > MAX_REGION_VOLUME) {
    return {
      ok: false,
      code: "REGION_TOO_LARGE",
      message: `Region volume ${volume} exceeds max ${MAX_REGION_VOLUME}`,
      details: { volume, max: MAX_REGION_VOLUME, region: args.region }
    };
  }
  const dimension = getDimension(args.dimension);
  const counts = {};
  let read = 0;
  let unloaded = 0;
  const { min, max } = args.region;
  for (let x = min.x; x <= max.x; x++) {
    for (let y = min.y; y <= max.y; y++) {
      for (let z = min.z; z <= max.z; z++) {
        const block = dimension.getBlock({ x, y, z });
        if (!block || !block.isValid) {
          unloaded += 1;
          continue;
        }
        read += 1;
        counts[block.typeId] = (counts[block.typeId] ?? 0) + 1;
      }
    }
  }
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      region: args.region,
      volume,
      blocksRead: read,
      unloaded,
      typeCounts: counts
    },
    completedWork: read,
    totalEstimatedWork: volume,
    message: `Inspected ${read}/${volume} blocks`
  };
}
function inspectTime(args) {
  const dimensionId = args.dimension ?? "minecraft:overworld";
  return {
    ok: true,
    result: {
      dimension: dimensionId,
      timeOfDay: world2.getTimeOfDay(),
      absoluteTime: world2.getAbsoluteTime(),
      day: world2.getDay()
    },
    completedWork: 1,
    totalEstimatedWork: 1,
    message: "Time inspected"
  };
}
function inspectWeather(args) {
  const dimensionId = args.dimension ?? "minecraft:overworld";
  const dimension = getDimension(dimensionId);
  return {
    ok: true,
    result: {
      dimension: dimensionId,
      weather: dimension.getWeather()
    },
    completedWork: 1,
    totalEstimatedWork: 1,
    message: "Weather inspected"
  };
}
function inspectGameRules(args) {
  const rules = world2.gameRules;
  const names = args.names && args.names.length > 0 ? args.names : [...DEFAULT_GAME_RULE_KEYS];
  const values = {};
  const ruleBag = rules;
  for (const name of names) {
    values[name] = ruleBag[name] ?? null;
  }
  return {
    ok: true,
    result: { rules: values },
    completedWork: names.length,
    totalEstimatedWork: names.length,
    message: `Read ${names.length} game rule(s)`
  };
}
function inspectEntities(args) {
  const dimension = getDimension(args.dimension);
  const filter = args.typeFilter?.toLowerCase();
  const limit = args.limit ?? 64;
  const entities = dimension.getEntities();
  const matched = [];
  for (const entity of entities) {
    if (filter && !entity.typeId.toLowerCase().includes(filter)) continue;
    const loc = entity.location;
    matched.push({
      id: entity.id,
      typeId: entity.typeId,
      nameTag: entity.nameTag || void 0,
      location: {
        x: Math.floor(loc.x),
        y: Math.floor(loc.y),
        z: Math.floor(loc.z)
      }
    });
    if (matched.length >= limit) break;
  }
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      count: matched.length,
      truncated: entities.length > matched.length,
      entities: matched
    },
    completedWork: matched.length,
    totalEstimatedWork: matched.length,
    message: `Found ${matched.length} entit${matched.length === 1 ? "y" : "ies"}`
  };
}
function inspectScoreboard(args) {
  const scoreboard = world2.scoreboard;
  const objectives = scoreboard.getObjectives();
  const selected = args.objective ? objectives.filter((o) => o.id === args.objective) : objectives;
  if (args.objective && selected.length === 0) {
    return {
      ok: false,
      code: "OBJECTIVE_NOT_FOUND",
      message: `Objective '${args.objective}' not found`
    };
  }
  const result = selected.map((obj) => {
    const participants = obj.getParticipants();
    const scores = participants.slice(0, 64).map((p) => ({
      displayName: p.displayName,
      score: obj.getScore(p) ?? null
    }));
    return {
      id: obj.id,
      displayName: obj.displayName,
      participantCount: participants.length,
      scores
    };
  });
  return {
    ok: true,
    result: { objectives: result },
    completedWork: result.length,
    totalEstimatedWork: result.length,
    message: `Read ${result.length} objective(s)`
  };
}
function inspectTags(args) {
  if (args.player !== false) {
    const player = world2.getPlayers().find((p) => p.name === args.target || p.id === args.target);
    if (player) {
      const tags = player.getTags();
      return {
        ok: true,
        result: { kind: "player", name: player.name, id: player.id, tags },
        completedWork: tags.length,
        totalEstimatedWork: tags.length,
        message: `Player ${player.name} has ${tags.length} tag(s)`
      };
    }
  }
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    const entities = world2.getDimension(dimId).getEntities();
    const entity = entities.find((e) => e.id === args.target || e.nameTag === args.target);
    if (entity) {
      const tags = entity.getTags();
      return {
        ok: true,
        result: {
          kind: "entity",
          id: entity.id,
          typeId: entity.typeId,
          nameTag: entity.nameTag || void 0,
          tags
        },
        completedWork: tags.length,
        totalEstimatedWork: tags.length,
        message: `Entity ${entity.typeId} has ${tags.length} tag(s)`
      };
    }
  }
  return {
    ok: false,
    code: "TARGET_NOT_FOUND",
    message: `No player or entity matched '${args.target}'`
  };
}

// src/tools/mutate.ts
import { system, world as world3 } from "@minecraft/server";
var cancelled = /* @__PURE__ */ new Set();
var emergencyDisabled = false;
function isEmergencyDisabled() {
  return emergencyDisabled;
}
function executeControl(action) {
  if (action.toolName === "control.cancel") {
    cancelled.add(String(action.arguments.actionId));
    return {
      state: "completed",
      completedWork: 1,
      totalEstimatedWork: 1,
      message: "Cancellation requested"
    };
  }
  emergencyDisabled = action.arguments.disabled === true;
  return {
    state: "completed",
    completedWork: 1,
    totalEstimatedWork: 1,
    message: `Emergency disable ${emergencyDisabled ? "enabled" : "cleared"}`
  };
}
function executeAdminCommand(action, allowlist) {
  if (emergencyDisabled) {
    return {
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message: "Emergency disabled",
      error: { code: "EMERGENCY_DISABLED", message: "Mutations disabled" }
    };
  }
  const args = action.arguments;
  const entry = allowlist[args.commandId];
  if (!entry) {
    return {
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message: "Command not allowlisted",
      error: { code: "UNKNOWN_COMMAND", message: `commandId '${args.commandId}' is not allowlisted` }
    };
  }
  if (args.command && args.command !== entry.command) {
    return {
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message: "Command mismatch",
      error: {
        code: "COMMAND_MISMATCH",
        message: "Resolved command does not match add-on allowlist"
      }
    };
  }
  try {
    const dimension = world3.getDimension("minecraft:overworld");
    const result = dimension.runCommand(entry.command);
    return {
      state: "completed",
      completedWork: 1,
      totalEstimatedWork: 1,
      message: `Ran allowlisted command ${args.commandId}`,
      result: {
        commandId: args.commandId,
        successCount: result.successCount ?? 1
      }
    };
  } catch (e) {
    return {
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message: e instanceof Error ? e.message : "Command failed",
      error: {
        code: "COMMAND_FAILED",
        message: e instanceof Error ? e.message : "Command failed"
      }
    };
  }
}
function startFill(action, emit, protectedRegions = []) {
  const args = action.arguments;
  const total = regionVolume(args.region);
  if (emergencyDisabled) {
    emit({
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: total,
      message: "Emergency disabled",
      error: { code: "EMERGENCY_DISABLED", message: "Mutations disabled" }
    });
    return;
  }
  if (total > MAX_BUILD_VOLUME) {
    emit({
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: total,
      message: "Build too large",
      error: { code: "REGION_TOO_LARGE", message: "Build exceeds independent add-on limit" }
    });
    return;
  }
  const overlaps = (a, b) => a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
  if (protectedRegions.some(
    (p) => p.dimension === args.dimension && overlaps(p.region, args.region)
  )) {
    emit({
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: total,
      message: "Protected region",
      error: {
        code: "PROTECTED_REGION",
        message: "Build intersects an add-on protected region"
      }
    });
    return;
  }
  const dimension = world3.getDimension(args.dimension);
  let completed = 0;
  const rollback = [];
  function* job() {
    try {
      const { min, max } = args.region;
      for (let x = min.x; x <= max.x; x++)
        for (let y = min.y; y <= max.y; y++)
          for (let z = min.z; z <= max.z; z++) {
            if (cancelled.has(action.actionId) || emergencyDisabled) {
              cancelled.delete(action.actionId);
              emit({
                state: "cancelled",
                completedWork: completed,
                totalEstimatedWork: total,
                message: `Cancelled after ${completed}/${total} blocks`,
                result: {
                  partial: true,
                  rollback: { available: rollback.length > 0, capturedBlocks: rollback.length }
                }
              });
              return;
            }
            const block = dimension.getBlock({ x, y, z });
            if (!block?.isValid) throw new Error(`Block unavailable at ${x},${y},${z}`);
            if (args.captureRollback && rollback.length < MAX_ROLLBACK_BLOCKS) {
              rollback.push({ position: { x, y, z }, typeId: block.typeId });
            }
            block.setType(args.blockType);
            completed++;
            if (completed % (args.batchSize ?? 512) === 0) {
              emit({
                state: "running",
                completedWork: completed,
                totalEstimatedWork: total,
                message: `Changed ${completed}/${total} blocks`
              });
              yield;
            }
          }
      emit({
        state: "completed",
        completedWork: completed,
        totalEstimatedWork: total,
        message: `Changed ${completed} blocks`,
        result: {
          dimension: args.dimension,
          region: args.region,
          blockType: args.blockType,
          rollback: {
            available: rollback.length === total,
            capturedBlocks: rollback.length,
            totalBlocks: total,
            coverage: rollback.length / total
          }
        }
      });
    } catch (e) {
      emit({
        state: completed ? "partially_completed" : "failed",
        completedWork: completed,
        totalEstimatedWork: total,
        message: e instanceof Error ? e.message : "Build failed",
        error: {
          code: "BUILD_FAILED",
          message: e instanceof Error ? e.message : "Build failed"
        }
      });
    }
  }
  system.runJob(job());
}

// src/net/client.ts
import {
  HttpHeader,
  HttpRequest,
  HttpRequestMethod,
  http
} from "@minecraft/server-net";
var ControllerClient = class {
  constructor(baseUrl, authToken) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
  }
  async postJson(path, body) {
    const req = new HttpRequest(`${this.baseUrl}${path}`);
    req.method = HttpRequestMethod.Post;
    req.body = JSON.stringify(body);
    req.timeout = 10;
    req.headers = [
      new HttpHeader("Content-Type", "application/json"),
      // Secret must already be the full header value, e.g. "Bearer <token>"
      // (SecretString cannot be concatenated in script).
      new HttpHeader("Authorization", this.authToken)
    ];
    const response = await http.request(req);
    let parsed = null;
    if (response.body) {
      try {
        parsed = JSON.parse(response.body);
      } catch {
        parsed = { raw: response.body };
      }
    }
    if (response.status < 200 || response.status >= 300) {
      const err = parsed && typeof parsed === "object" && "error" in parsed && parsed.error;
      const message = err && typeof err.message === "string" ? err.message : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return { status: response.status, body: parsed };
  }
};

// src/net/session.ts
var POLL_INTERVAL_TICKS = 40;
var HEARTBEAT_EVERY_N_POLLS = 3;
var ControllerSession = class {
  constructor(config) {
    this.config = config;
    this.sessionId = null;
    this.running = false;
    this.busy = false;
    this.pollCount = 0;
    this.idempotency = createIdempotencyTracker();
    this.client = new ControllerClient(config.controllerUrl, config.authToken);
  }
  start() {
    if (this.running) return;
    this.running = true;
    system2.runInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_TICKS);
    void this.handshake();
  }
  async handshake() {
    try {
      const req = createHandshake({
        sessionId: "pending",
        requestId: newId("req"),
        serverId: this.config.serverId,
        capabilities: ["inspect.read"]
      });
      const res = await this.client.postJson("/v1/bds/handshake", req);
      const parsed = validateHandshakeAck(res.body);
      if (!parsed.ok || !parsed.value.ok) {
        const msg = parsed.ok ? parsed.value.error?.message ?? "Handshake rejected" : parsed.error.message;
        notifyOperators(`Handshake failed: ${msg}`);
        this.sessionId = null;
        return;
      }
      this.sessionId = parsed.value.sessionId;
      notifyOperators(`Connected to controller (session ${this.sessionId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Handshake error";
      notifyOperators(`Handshake error: ${message}`);
      this.sessionId = null;
    }
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.sessionId) {
        await this.handshake();
        return;
      }
      this.pollCount += 1;
      if (this.pollCount % HEARTBEAT_EVERY_N_POLLS === 0) {
        await this.sendHeartbeat();
      }
      await this.pollOnce();
    } finally {
      this.busy = false;
    }
  }
  async sendHeartbeat() {
    if (!this.sessionId) return;
    const players = world4.getPlayers();
    const body = createHeartbeat({
      sessionId: this.sessionId,
      requestId: newId("req"),
      serverId: this.config.serverId,
      health: {
        ok: true,
        playerCount: players.length,
        tick: system2.currentTick,
        emergencyDisabled: isEmergencyDisabled()
      }
    });
    const res = await this.client.postJson("/v1/bds/heartbeat", body);
    if (res.status === 401) {
      this.sessionId = null;
    }
  }
  async pollOnce() {
    if (!this.sessionId) return;
    const poll = createPoll({
      sessionId: this.sessionId,
      requestId: newId("req")
    });
    const res = await this.client.postJson("/v1/bds/poll", poll);
    if (res.status === 401) {
      this.sessionId = null;
      return;
    }
    const parsed = validatePollResponse(res.body);
    if (!parsed.ok) {
      notifyOperators(`Bad poll response: ${parsed.error.message}`);
      return;
    }
    if (!parsed.value.action) return;
    await this.handleAction(parsed.value.action);
  }
  async handleAction(rawAction) {
    if (!this.sessionId) return;
    const validated = validateActionRequest(rawAction);
    if (!validated.ok) {
      await this.emitFailure(
        rawAction.actionId,
        validated.error.code,
        validated.error.message
      );
      return;
    }
    const action = validated.value;
    if (isExpired(action.expiresAt)) {
      await this.emitFailure(action.actionId, "EXPIRED", "Action expired");
      return;
    }
    if (this.idempotency.checkAndRemember(action.idempotencyKey)) {
      await this.emitFailure(
        action.actionId,
        "DUPLICATE",
        "Duplicate idempotencyKey"
      );
      return;
    }
    if (action.toolName === "world.fill_blocks") {
      startFill(action, (event) => {
        void this.emitEvent({ actionId: action.actionId, ...event });
      }, this.config.protectedRegions);
      return;
    }
    if (action.toolName.startsWith("control.")) {
      const event = executeControl(action);
      await this.emitEvent({ actionId: action.actionId, ...event });
      return;
    }
    if (action.toolName === "admin.run_command") {
      const event = executeAdminCommand(action, this.config.adminCommands);
      await this.emitEvent({ actionId: action.actionId, ...event });
      return;
    }
    const toolResult = executeInspectTool(action);
    if (!toolResult.ok) {
      await this.emitEvent({
        actionId: action.actionId,
        state: "failed",
        completedWork: 0,
        totalEstimatedWork: 1,
        message: toolResult.message,
        error: {
          code: toolResult.code,
          message: toolResult.message,
          details: toolResult.details
        }
      });
      return;
    }
    await this.emitEvent({
      actionId: action.actionId,
      state: "completed",
      completedWork: toolResult.completedWork,
      totalEstimatedWork: toolResult.totalEstimatedWork,
      message: toolResult.message,
      result: toolResult.result
    });
  }
  async emitFailure(actionId, code, message) {
    await this.emitEvent({
      actionId,
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message,
      error: { code, message }
    });
  }
  async emitEvent(params) {
    if (!this.sessionId) return;
    const event = createOperationEvent({
      sessionId: this.sessionId,
      requestId: newId("req"),
      operationId: newId("op"),
      actionId: params.actionId,
      state: params.state,
      completedWork: params.completedWork,
      totalEstimatedWork: params.totalEstimatedWork,
      message: params.message,
      result: params.result,
      error: params.error
    });
    await this.client.postJson("/v1/bds/events", event);
  }
};

// src/main.ts
console.warn("[IntelaCraft] Script loading (Phase 2 safe mutations)");
system3.run(() => {
  const config = loadConfig();
  if (!config.configured) {
    notifyOperators(
      `Not configured. Missing BDS variables/secrets: ${config.missing.join(", ")}`
    );
    return;
  }
  const session = new ControllerSession(config);
  session.start();
  notifyOperators("Controller session started");
});
