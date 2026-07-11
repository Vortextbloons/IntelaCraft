/** Protocol major.minor.patch negotiated at handshake. */
export const PROTOCOL_VERSION = "1.0.0";

export const PROTOCOL_MAJOR = 1;

/** Max inclusive volume for inspect.region (32^3). */
export const MAX_REGION_VOLUME = 32 * 32 * 32;
export const MAX_BUILD_VOLUME = 32 * 32 * 32;
export const STRONG_BUILD_VOLUME = 4096;
export const DEFAULT_BATCH_SIZE = 512;
export const MAX_ROLLBACK_BLOCKS = 8192;
/** Maximum individually addressed blocks in one deterministic placement action. */
export const MAX_PLACE_BLOCKS = 8192;

export const MESSAGE_TYPES = [
  "handshake",
  "handshake_ack",
  "poll",
  "poll_response",
  "action_request",
  "operation_event",
  "heartbeat",
  "error",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export const RISK_CLASSES = ["read", "normal", "strong", "prohibited"] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const PERMISSION_MODES = [
  "observe_only",
  "confirm_every_change",
  "allow_low_risk",
  "builder_region",
  "trusted_administrator",
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** AI capability boundary; independent from permission mode. */
export const AI_MODES = ["ask", "agent"] as const;
export type AiMode = (typeof AI_MODES)[number];

export const OPERATION_STATES = [
  "running",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

export const READ_TOOLS = [
  "inspect.server_status",
  "inspect.players",
  "inspect.player",
  "inspect.block",
  "inspect.region",
  "inspect.world_state",
  "inspect.entities",
  "inspect.scoreboard",
  "inspect.tags",
  "inspect.heightmap",
  "inspect.surface",
  "inspect.build_collision",
  "inspect.find_empty_area",
] as const;
export const MUTATION_TOOLS = [
  "world.fill_blocks",
  "world.place_blocks",
  "control.cancel",
  "control.emergency_disable",
  "admin.run_command",
] as const;

export type ReadToolName = (typeof READ_TOOLS)[number];
export type MutationToolName = (typeof MUTATION_TOOLS)[number];
export type ToolName = ReadToolName | MutationToolName;

export const DIMENSION_IDS = [
  "minecraft:overworld",
  "minecraft:nether",
  "minecraft:the_end",
] as const;

export type DimensionId = (typeof DIMENSION_IDS)[number];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
