import type { ActionRequestMessage, AiMode, PermissionMode } from "@intelacraft/shared-protocol";
import type {
  AgentPlan,
  ChatTurn,
  DiscoveredModel,
  InspectionToolName,
  PiSession,
  PlanStreamEvent,
  ProviderProfile,
  ThinkingLevel,
} from "@intelacraft/pi-extension";
import type { AdvisoryMcpClient } from "@intelacraft/mcp-connection";
import type { BuildPreview, WorldSnapshot } from "@intelacraft/construction";
import type { ControllerConfig } from "../config.js";
import type { SessionStore, SettingsStore } from "../store.js";
import type { AuditLog } from "../audit.js";

export type AgentTaskState =
  | "submitted"
  | "planning"
  | "inspecting"
  | "awaiting_approval"
  | "planned"
  | "running"
  | "verifying"
  | "rejected"
  | "cancelled"
  | "completed"
  | "partial"
  | "failed";

export interface AgentTask {
  id: string;
  piSessionId: string;
  request: string;
  state: AgentTaskState;
  createdAt: string;
  updatedAt: string;
  plan?: AgentPlan;
  preview?: BuildPreview;
  worldSnapshot?: WorldSnapshot;
  /** Mutations awaiting approval, or inspect-only actions once materialized. */
  proposedActions?: ActionRequestMessage[];
  /** Read-only inspection actions auto-enqueued without approval. */
  pendingReads?: ActionRequestMessage[];
  /** Verification reads to run after mutations. */
  pendingVerification?: ActionRequestMessage[];
  enqueuedActionIds?: string[];
  completedActionIds?: string[];
  /** Action IDs that belong to the current inspect wave (for replan gating). */
  inspectActionIds?: string[];
  /** Action IDs that belong to mutation wave. */
  mutationActionIds?: string[];
  /** Action IDs that belong to verification wave. */
  verifyActionIds?: string[];
  /** Exact tool attribution for every materialized action, keyed by action ID. */
  actionToolNames?: Record<string, string>;
  error?: string;
  bdsSessionId?: string;
  actor?: string;
  permissionMode?: PermissionMode;
  mode: AiMode;
  metrics?: {
    planLatencyMs?: number;
    validationRetries?: number;
    usedNormalizeFallback?: boolean;
    inspectionToolCalls?: number;
    inspectionCacheHits?: number;
  };
  /** True when we deferred mutations until inspect completes + replan. */
  awaitingInspectReplan?: boolean;
  /** Guards the single post-mutation agent verification turn. */
  agentVerificationStarted?: boolean;
}

export interface InspectionWaiter {
  resolve: (value: { message: string; result?: unknown }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Shared mutable runtime state accessed by agent submodules. */
export interface AgentContext {
  config: ControllerConfig;
  profiles: Map<string, ProviderProfile>;
  activeProviderId: string;
  pi: Map<string, PiSession>;
  tasks: Map<string, AgentTask>;
  taskPersistenceTimer?: ReturnType<typeof setTimeout>;
  taskPersistencePending: boolean;
  taskPersistenceInFlight?: Promise<void>;
  settingsRef?: SettingsStore;
  chatHistory: Map<string, ChatTurn[]>;
  operationEventQueues: Map<string, Promise<void>>;
  toolCallingSupport: Map<string, boolean>;
  inspectionWaiters: Map<string, InspectionWaiter>;
  thinkingLevel: ThinkingLevel;
  mcp: AdvisoryMcpClient;
  verifyAfterMutations(taskId: string, sessions: SessionStore, audit: AuditLog): Promise<void>;
}

export interface PlanInput {
  bdsSessionId: string;
  actor?: string;
  permissionMode?: PermissionMode;
  sessions?: SessionStore;
  audit?: AuditLog;
}

export interface CreateTaskInput {
  piSessionId: string;
  request: string;
  worldContext?: unknown;
  useMcp?: boolean;
  permissionMode?: PermissionMode;
  mode?: AiMode;
  bdsSessionId: string;
  actor?: string;
  sessions?: SessionStore;
  audit?: AuditLog;
  history?: ChatTurn[];
}

export type { AgentPlan, ChatTurn, DiscoveredModel, PlanStreamEvent, ProviderProfile, ThinkingLevel };
