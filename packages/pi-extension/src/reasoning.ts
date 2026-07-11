import {
  THINKING_LEVELS,
  type ReasoningCapabilities,
  type ThinkingLevel,
} from "@intelacraft/shared-protocol";
import { MODEL_OVERRIDES } from "./model-overrides.js";
import type { ProviderProfile } from "./types.js";

const ALL_LEVELS: readonly ThinkingLevel[] = THINKING_LEVELS;

const DEFAULT_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

export function getReasoningCapabilities(
  modelId: string,
  modelMeta?: { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> },
  provider?: Pick<ProviderProfile, "id" | "baseUrl">,
): ReasoningCapabilities {
  const override = MODEL_OVERRIDES[modelId];
  if (override) {
    return {
      supported: override.supported,
      levels: [...override.levels],
      preferredLevel: override.preferredLevel,
      source: "override",
    };
  }

  if (modelMeta?.thinkingLevelMap) {
    const levels: ThinkingLevel[] = [];
    for (const level of ALL_LEVELS) {
      const mapped = modelMeta.thinkingLevelMap[level];
      if (mapped !== null && mapped !== undefined) {
        levels.push(level);
      } else if (mapped === undefined && DEFAULT_LEVELS.includes(level)) {
        levels.push(level);
      }
    }
    if (levels.length === 0) levels.push("off");
    const supported = modelMeta.reasoning !== false && levels.some((l) => l !== "off");
    return {
      supported,
      levels,
      preferredLevel: supported ? "medium" : "off",
      source: "pi",
    };
  }

  if (modelMeta?.reasoning) {
    return {
      supported: true,
      levels: [...DEFAULT_LEVELS],
      preferredLevel: "medium",
      source: "pi",
    };
  }

  // Groq's broadly available Llama models accept OpenAI-compatible chat and
  // tools, but do not accept a `reasoning_effort` setting. Their catalog does
  // not advertise that distinction, so avoid applying the generic fallback.
  if (
    provider &&
    (provider.id === "groq" || /(?:^|\/\/)api\.groq\.com(?:\/|$)/i.test(provider.baseUrl))
  ) {
    return {
      supported: false,
      levels: ["off"],
      preferredLevel: "off",
      source: "provider",
    };
  }

  return {
    // OpenAI-compatible catalogs commonly return only an id.  Absence of
    // metadata is not evidence that a model cannot reason (notably OpenCode
    // Zen models); expose the portable effort levels until a provider tells us
    // otherwise.
    supported: true,
    levels: [...DEFAULT_LEVELS],
    preferredLevel: "medium",
    source: "unknown",
  };
}

export function clampThinkingLevel(
  modelId: string,
  requested: ThinkingLevel,
  modelMeta?: { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> },
  provider?: Pick<ProviderProfile, "id" | "baseUrl">,
): ThinkingLevel {
  const caps = getReasoningCapabilities(modelId, modelMeta, provider);
  if (caps.levels.includes(requested)) return requested;
  if (requested === "off" || caps.levels.length === 0) return "off";
  const rank = (l: ThinkingLevel) => ALL_LEVELS.indexOf(l);
  const target = rank(requested);
  let best: ThinkingLevel = "off";
  let bestDist = Infinity;
  for (const level of caps.levels) {
    if (level === "off") continue;
    const dist = Math.abs(rank(level) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = level;
    }
  }
  return best;
}
