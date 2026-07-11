import type { AgentPlan, ChatTurn } from "@intelacraft/pi-extension";
import type { AgentContext } from "./types.js";

export function resolveHistory(ctx: AgentContext, piSessionId: string, clientHistory?: ChatTurn[]): ChatTurn[] {
  const stored = ctx.chatHistory.get(piSessionId) ?? [];
  if (!clientHistory?.length) return stored.slice(-16);
  const normalized = clientHistory
    .filter((t) => (t.role === "user" || t.role === "assistant") && t.content?.trim())
    .map((t) => ({ role: t.role, content: String(t.content).slice(0, 4000) }))
    .slice(-16);
  // Client transcript is the source of truth for the open chat thread.
  ctx.chatHistory.set(piSessionId, normalized);
  return normalized;
}

export function appendHistory(ctx: AgentContext, piSessionId: string, turn: ChatTurn) {
  const rows = ctx.chatHistory.get(piSessionId) ?? [];
  rows.push({ role: turn.role, content: turn.content.slice(0, 4000) });
  while (rows.length > 32) rows.shift();
  ctx.chatHistory.set(piSessionId, rows);
}

export function planHistoryText(plan: AgentPlan): string {
  const bits = [plan.summary];
  for (const step of plan.inspection) {
    bits.push(`[inspect] ${step.toolName}: ${step.summary}`);
  }
  for (const step of plan.actions) {
    bits.push(`[action] ${step.toolName}: ${step.summary}`);
  }
  if (plan.notes?.length) bits.push(`notes: ${plan.notes.join("; ")}`);
  return bits.filter(Boolean).join("\n").slice(0, 4000);
}

export function getTaskTranscript(ctx: AgentContext, id: string): ChatTurn[] {
  const t = ctx.tasks.get(id);
  if (!t) return [];
  return [...(ctx.chatHistory.get(t.piSessionId) ?? [])];
}
