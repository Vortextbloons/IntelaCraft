import { wrapUntrusted } from "@intelacraft/prompts";
import { embedded } from "../session/store.js";
import type { AgentPlan, PlanOptions } from "../types.js";
import { assistantTextFromSession, extractJsonObject, normalizePlan } from "./normalize.js";

/**
 * Plan via the real embedded Pi AgentSession (multi-turn, custom tools, isolated config).
 */
export async function planWithPiSession(
  sessionId: string,
  userRequest: string,
  worldContext: unknown,
  mcpAdvice?: unknown,
  onDeltaOrOptions?: ((text: string) => void) | PlanOptions,
  maybeOptions?: PlanOptions,
): Promise<AgentPlan> {
  const emb = embedded.get(sessionId);
  if (!emb) throw new Error("Pi session is not initialized");

  const options: PlanOptions =
    typeof onDeltaOrOptions === "function"
      ? { ...(maybeOptions ?? {}), onEvent: (e) => {
          if (e.type === "delta") onDeltaOrOptions(e.text);
          maybeOptions?.onEvent?.(e);
        } }
      : onDeltaOrOptions ?? maybeOptions ?? {};

  const onEvent = options.onEvent;
  emb.lastPlan = undefined;

  if (options.thinkingLevel && options.thinkingLevel !== (emb.session as any).thinkingLevel) {
    try {
      emb.session.setThinkingLevel?.(options.thinkingLevel);
    } catch {
      /* model may not support thinking */
    }
  }

  const unsub = emb.session.subscribe((event: any) => {
    if (event.type === "message_update" && event.assistantMessageEvent) {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta" && typeof ame.delta === "string") {
        onEvent?.({ type: "delta", text: ame.delta });
      } else if (
        (ame.type === "thinking_delta" || ame.type === "reasoning_delta") &&
        typeof ame.delta === "string"
      ) {
        onEvent?.({ type: "reasoning_delta", text: ame.delta });
      }
    }
    if (event.type === "tool_execution_start") {
      onEvent?.({
        type: "tool",
        name: String(event.toolName ?? "tool"),
        phase: "start",
        toolCallId: event.toolCallId ? String(event.toolCallId) : undefined,
      });
    }
    if (event.type === "tool_execution_end") {
      const result = event.result ?? event.output ?? event.content;
      onEvent?.({
        type: "tool",
        name: String(event.toolName ?? "tool"),
        phase: "end",
        toolCallId: event.toolCallId ? String(event.toolCallId) : undefined,
        isError: Boolean(event.isError),
        detail:
          result == null
            ? undefined
            : typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2),
      });
    }
  });

  const historyNote =
    options.history?.length
      ? `\n\nPrior chat turns (untrusted user/assistant text):\n${JSON.stringify(options.history.slice(-12), null, 2)}`
      : "";

  const validationNote = options.validationError
    ? `\n\nPrevious plan failed validation. Fix and call submit_plan again.\nValidation error: ${options.validationError}`
    : "";

  const adminIds = options.adminCommandIds ?? [];
  const payload = {
    request: userRequest,
    adminCommandIds: adminIds,
    reminder:
      options.mode === "ask"
        ? "Current mode is Ask: answer or inspect read-only state only. actions and verification must both be empty. If the user requests a change, explain that Agent mode is required. Always call submit_plan with a concise summary and empty arrays for a normal chat answer."
        : "Current mode is Agent: use live inspect_* tools when needed, then call submit_plan. Always include successCriteria and evidence arrays. For greetings use empty arrays. Use tool results for follow-ups and never guess world state.",
  };

  try {
    await emb.session.prompt(
      `User request and trusted metadata (JSON):\n${JSON.stringify(payload, null, 2)}\n\n` +
        `${wrapUntrusted("untrusted_world_context", worldContext)}\n\n` +
        `${wrapUntrusted("untrusted_mcp_advice", mcpAdvice ?? null)}` +
        historyNote +
        validationNote +
        `\n\nCall submit_plan now.`,
    );
  } finally {
    unsub();
  }

  if (emb.lastPlan) return emb.lastPlan;

  const text = assistantTextFromSession(emb.session);
  if (text.trim()) {
    try {
      return normalizePlan(extractJsonObject(text), userRequest);
    } catch {
      return normalizePlan(
        { summary: text.trim().slice(0, 2000), inspection: [], actions: [], verification: [], notes: [] },
        userRequest,
      );
    }
  }

  return normalizePlan(
    {
      summary: "I can help inspect the Bedrock world or plan bounded builds. What should we do?",
      inspection: [],
      actions: [],
      verification: [],
      notes: [],
    },
    userRequest,
  );
}

/** Inject a world-tool result into Pi history for the next turn (no LLM call). */
export async function injectPiToolResult(sessionId: string, toolName: string, message: string, result?: unknown) {
  const emb = embedded.get(sessionId);
  if (!emb) return;
  const text =
    result !== undefined
      ? `[tool result ${toolName}] ${message}\n${JSON.stringify(result).slice(0, 1500)}`
      : `[tool result ${toolName}] ${message}`;
  await emb.session.sendCustomMessage(
    {
      customType: "intelacraft_tool_result",
      content: text.slice(0, 4000),
      display: true,
      details: { toolName, message, result },
    },
    { deliverAs: "nextTurn" },
  );
}
