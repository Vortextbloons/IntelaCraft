export type Health = {
  ok: boolean;
  bdsConnected: boolean;
  sessions: Array<{
    sessionId: string;
    serverId: string;
    connected: boolean;
    emergencyDisabled?: boolean;
    health?: {
      ok?: boolean;
      playerCount?: number;
      tick?: number;
    } | null;
  }>;
  settings?: { permissionMode: string; thinkingLevel?: string };
  agent?: {
    pi: boolean;
    sessions: number;
    providers: number;
    mcp?: { configured?: boolean; available?: boolean };
  };
};

export type PlanStep = {
  toolName: string;
  summary?: string;
  arguments?: Record<string, unknown>;
};

export type ProposedAction = {
  actionId: string;
  toolName: string;
  risk: string;
  arguments: Record<string, unknown>;
};

export type Task = {
  id: string;
  request: string;
  state: string;
  plan?: {
    summary: string;
    notes?: string[];
    inspection?: PlanStep[];
    actions?: PlanStep[];
    verification?: PlanStep[];
  };
  proposedActions?: ProposedAction[];
  enqueuedActionIds?: string[];
  completedActionIds?: string[];
  error?: string;
  metrics?: {
    planLatencyMs?: number;
    validationRetries?: number;
    usedNormalizeFallback?: boolean;
  };
};

export type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
};

export type ActivityRecord = {
  loggedAt: string;
  type: string;
  taskId?: string;
  actionId?: string;
  message?: string;
  state?: string;
  risk?: string;
  toolName?: string;
};

export type ToolRun = {
  actionId: string;
  toolName?: string;
  phase?: "inspect" | "mutate" | "verify" | "plan";
  state: string;
  completedWork: number;
  totalEstimatedWork: number;
  message: string;
  result?: unknown;
  error?: string;
};

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; streaming?: boolean }
  | {
      type: "tool_call";
      id: string;
      name: string;
      phase?: ToolRun["phase"];
      argsSummary?: string;
      state: string;
      progress?: { completed: number; total: number };
      resultText?: string;
      error?: string;
    }
  | { type: "status"; text: string }
  | { type: "plan"; taskId: string };

export type ChatMsg = {
  id: string;
  role: "user" | "system" | "assistant";
  /** Plain text for user/system; assistant may also use parts. */
  text: string;
  parts?: MessagePart[];
  taskId?: string;
  toolRuns?: ToolRun[];
  streaming?: boolean;
};

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

export function taskNeedsPlanCard(task: Task): boolean {
  const hasSteps =
    (task.plan?.inspection?.length ?? 0) > 0 ||
    (task.plan?.actions?.length ?? 0) > 0 ||
    (task.plan?.verification?.length ?? 0) > 0 ||
    (task.proposedActions?.some((a) => a.risk !== "read") ?? false);
  if (!hasSteps) return false;
  return ["inspecting", "awaiting_approval", "running", "partial", "planned", "verifying"].includes(
    task.state,
  );
}

export function taskNeedsApproval(task: Task): boolean {
  return (
    task.state === "awaiting_approval" &&
    (task.proposedActions?.some((a) => a.risk !== "read") ?? false)
  );
}

export function isReadOnlyPlan(task: Task): boolean {
  const mutations = (task.proposedActions ?? []).filter((a) => a.risk !== "read");
  if (mutations.length > 0) return false;
  if ((task.plan?.actions?.length ?? 0) > 0) return false;
  return (
    (task.proposedActions?.length ?? 0) > 0 || (task.plan?.inspection?.length ?? 0) > 0
  );
}
