import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { THINKING_LEVELS, type ThinkingLevel } from "@intelacraft/shared-protocol";
import { getReasoningCapabilities } from "../reasoning.js";
import type { ProviderProfile } from "../types.js";

const ALL_LEVELS: readonly ThinkingLevel[] = THINKING_LEVELS;

export function sanitizeProviderId(id: string): string {
  return `intelacraft_${id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48)}`;
}

export function writeModelsJson(
  storagePath: string,
  piProvider: string,
  provider: ProviderProfile,
  thinkingLevel: ThinkingLevel = "off",
  builtinModel?: {
    reasoning?: boolean;
    thinkingLevelMap?: Record<string, string | null>;
    input?: ("text" | "image")[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
    /** Provider/model protocol flags supplied by Pi's built-in catalog. */
    compat?: object;
  },
): void {
  const reasoning = builtinModel?.reasoning ?? (thinkingLevel !== "off");

  // Prefer Pi's built-in model metadata over our overrides
  let thinkingLevelMap: Record<string, string | null> | undefined;
  if (builtinModel?.thinkingLevelMap) {
    thinkingLevelMap = builtinModel.thinkingLevelMap;
  } else {
    const caps = getReasoningCapabilities(provider.model, undefined, provider);
    if (caps.source === "override" && caps.levels.length > 1) {
      thinkingLevelMap = Object.fromEntries(
        ALL_LEVELS.map((l) => [l, caps.levels.includes(l) ? l : null]),
      );
    }
  }

  const modelEntry: Record<string, unknown> = {
    id: provider.model,
    name: provider.model,
    reasoning,
    input: builtinModel?.input ?? ["text"],
    contextWindow: builtinModel?.contextWindow ?? 128000,
    maxTokens: builtinModel?.maxTokens ?? 8192,
    cost: builtinModel?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  if (builtinModel?.compat) {
    // Preserve provider-specific replay and token-field behavior. In
    // particular, OpenCode Zen's DeepSeek models require reasoning_content
    // on replayed assistant messages during tool-call conversations.
    modelEntry.compat = builtinModel.compat;
  }
  if (thinkingLevelMap) {
    modelEntry.thinkingLevelMap = thinkingLevelMap;
  }

  const payload = {
    providers: {
      [piProvider]: {
        baseUrl: provider.baseUrl.replace(/\/$/, ""),
        api: "openai-completions",
        apiKey: provider.apiKey,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: reasoning,
          ...(builtinModel?.compat ?? {}),
        },
        models: [modelEntry],
      },
    },
  };
  writeFileSync(resolve(storagePath, "models.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
