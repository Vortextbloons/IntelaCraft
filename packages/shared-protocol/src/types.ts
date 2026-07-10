import type {
  DimensionId,
  MessageType,
  OperationState,
  PermissionMode,
  RiskClass,
  ToolName,
} from "./constants.js";

export interface Vec3i {
  x: number;
  y: number;
  z: number;
}

export interface RegionBounds {
  min: Vec3i;
  max: Vec3i;
}

export interface MessageEnvelope {
  protocolVersion: string;
  messageType: MessageType;
  requestId: string;
  sessionId: string;
  timestamp: string;
}

export interface ProtocolErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface HandshakeMessage extends MessageEnvelope {
  messageType: "handshake";
  serverId: string;
  clientProtocolVersion: string;
  capabilities?: string[];
}

export interface HandshakeAckMessage extends MessageEnvelope {
  messageType: "handshake_ack";
  acceptedProtocolVersion: string;
  serverId: string;
  ok: boolean;
  error?: ProtocolErrorBody;
}

export interface PollMessage extends MessageEnvelope {
  messageType: "poll";
}

export interface PollResponseMessage extends MessageEnvelope {
  messageType: "poll_response";
  action: ActionRequestMessage | null;
}

export interface ApprovalRecord {
  approvalId: string;
  approvedAt: string;
  approvedBy: string;
  /** SHA-256 hex of the immutable action payload that was displayed. */
  payloadHash: string;
}

export interface FillBlocksArgs {
  dimension: DimensionId;
  region: RegionBounds;
  blockType: string;
  batchSize?: number;
  captureRollback?: boolean;
}

export interface ActionRequestMessage extends MessageEnvelope {
  messageType: "action_request";
  actionId: string;
  idempotencyKey: string;
  toolName: ToolName;
  arguments: Record<string, unknown>;
  actor: string;
  permissionMode: PermissionMode;
  risk: RiskClass;
  approval?: ApprovalRecord;
  noApprovalReason?: string;
  expiresAt: string;
}

export interface OperationEventMessage extends MessageEnvelope {
  messageType: "operation_event";
  operationId: string;
  actionId: string;
  state: OperationState;
  completedWork: number;
  totalEstimatedWork: number;
  message: string;
  result?: unknown;
  error?: ProtocolErrorBody;
}

export interface HeartbeatMessage extends MessageEnvelope {
  messageType: "heartbeat";
  serverId: string;
  health: {
    ok: boolean;
    playerCount: number;
    tick?: number;
    emergencyDisabled?: boolean;
  };
}

export interface ErrorMessage extends MessageEnvelope {
  messageType: "error";
  error: ProtocolErrorBody;
}

export type ProtocolMessage =
  | HandshakeMessage
  | HandshakeAckMessage
  | PollMessage
  | PollResponseMessage
  | ActionRequestMessage
  | OperationEventMessage
  | HeartbeatMessage
  | ErrorMessage;

export interface InspectBlockArgs {
  dimension: DimensionId;
  position: Vec3i;
}

export interface InspectRegionArgs {
  dimension: DimensionId;
  region: RegionBounds;
  /** When true, include per-block type counts only (default). */
  countsOnly?: boolean;
}

export interface InspectPlayersArgs {
  /** Optional name substring filter (case-insensitive). */
  nameFilter?: string;
}

export interface InspectTimeArgs {
  dimension?: DimensionId;
}

export interface InspectWeatherArgs {
  dimension?: DimensionId;
}

export interface InspectGameRulesArgs {
  /** When omitted, return a curated allowlisted subset. */
  names?: string[];
}

export interface InspectServerStatusArgs {
  includeDimensions?: boolean;
}
