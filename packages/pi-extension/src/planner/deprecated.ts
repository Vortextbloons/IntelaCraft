import type { ProviderProfile, ChatTurn, AgentPlan } from "../types.js";
import { normalizePlan } from "./normalize.js";

/** @deprecated Prefer planWithPiSession — kept for tests that only exercise normalizePlan paths. */
export async function planRequest(
  _profile: ProviderProfile,
  userRequest: string,
  worldContext: unknown,
  mcpAdvice?: unknown,
  _history: ChatTurn[] = [],
): Promise<AgentPlan> {
  // Without a live Pi session, synthesize a minimal inspect plan for known asks (tests / fallback).
  if (/online|players|who.?s on/i.test(userRequest)) {
    return normalizePlan(
      {
        summary: "Checking online players.",
        inspection: [{ toolName: "inspect.players", arguments: {}, summary: "List players" }],
        actions: [],
        verification: [],
        notes: [],
      },
      userRequest,
    );
  }
  void worldContext;
  void mcpAdvice;
  return normalizePlan(
    { summary: "I can help inspect the Bedrock world or plan bounded builds.", inspection: [], actions: [], verification: [], notes: [] },
    userRequest,
  );
}

export async function planRequestStream(
  profile: ProviderProfile,
  userRequest: string,
  worldContext: unknown,
  mcpAdvice?: unknown,
  onDelta?: (text: string) => void,
  history: ChatTurn[] = [],
): Promise<AgentPlan> {
  const plan = await planRequest(profile, userRequest, worldContext, mcpAdvice, history);
  if (onDelta && plan.summary) onDelta(JSON.stringify(plan));
  return plan;
}
