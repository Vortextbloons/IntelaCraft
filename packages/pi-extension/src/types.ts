import type { AiMode, ThinkingLevel } from "@intelacraft/shared-protocol";

export type { ThinkingLevel, DiscoveredModel, ReasoningCapabilities } from "@intelacraft/shared-protocol";
export { THINKING_LEVELS } from "@intelacraft/shared-protocol";

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AgentAction {
  id?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  summary: string;
  dependsOn?: string[];
}

export interface AgentPlan {
  summary: string;
  outcome?: "respond" | "propose" | "complete" | "blocked";
  successCriteria?: string[];
  evidence?: string[];
  inspection: AgentAction[];
  actions: AgentAction[];
  verification: AgentAction[];
  notes: string[];
  /** Construction-aware metadata retained with executable actions. */
  build?: {
    palette: Array<{ role: string; blockType: string }>;
    steps: Array<{ id: string; summary: string; toolName: string; arguments: Record<string, unknown>; dependsOn?: string[]; risk?: string }>;
    estimates: { blocksChanged: number; operations: number };
    warnings: string[];
  };
}

/** Prior chat turns for multi-turn planning context (UI sync / fallback). */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Streaming events from a planning turn. */
export type PlanStreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "status"; text: string }
  | {
      type: "tool";
      name: string;
      phase: "start" | "end";
      /** Stable id so start/end update one UI row. */
      toolCallId?: string;
      detail?: string;
      isError?: boolean;
    };

export interface PlanOptions {
  mode?: AiMode;
  thinkingLevel?: ThinkingLevel;
  adminCommandIds?: string[];
  /** When set, ask the model to fix a previous invalid plan. */
  validationError?: string;
  history?: ChatTurn[];
  onEvent?: (event: PlanStreamEvent) => void;
}

export type InspectionToolName = `inspect.${string}`;
export type InspectionExecutor = (
  toolName: InspectionToolName,
  arguments_: Record<string, unknown>,
) => Promise<{ message: string; result?: unknown }>;
export type CatalogExecutor = (operation: "search" | "resolve", arguments_: Record<string, unknown>) => Promise<{ message: string; result?: unknown }>;
export type BuildExecutor = (operation:"compile"|"modify",arguments_:Record<string,unknown>)=>Promise<{message:string;result?:unknown}>;
export type BuildSaveExecutor=(arguments_:Record<string,unknown>)=>Promise<{message:string;result?:unknown}>;

export interface PiSession {
  id: string;
  providerId: string;
  model: string;
  storagePath: string;
  createdAt: string;
  /** Sanitized Pi provider id used in models.json / auth.json */
  piProvider?: string;
  thinkingLevel?: ThinkingLevel;
  /** Current conversation capability boundary, owned by the controller. */
  mode: AiMode;
}
