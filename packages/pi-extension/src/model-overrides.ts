import type { ThinkingLevel } from "@intelacraft/shared-protocol";

export interface ModelOverride {
  supported: boolean;
  levels: ThinkingLevel[];
  preferredLevel: ThinkingLevel;
}

export const MODEL_OVERRIDES: Record<string, ModelOverride> = {
  "o3": { supported: true, levels: ["off", "low", "medium", "high", "xhigh", "max"], preferredLevel: "high" },
  "o3-mini": { supported: true, levels: ["off", "low", "medium", "high"], preferredLevel: "medium" },
  "o3-pro": { supported: true, levels: ["off", "low", "medium", "high", "xhigh", "max"], preferredLevel: "high" },
  "o4-mini": { supported: true, levels: ["off", "low", "medium", "high", "xhigh", "max"], preferredLevel: "high" },
  "claude-sonnet-4-20250514": { supported: true, levels: ["off", "low", "medium", "high"], preferredLevel: "medium" },
  "claude-opus-4-20250514": { supported: true, levels: ["off", "low", "medium", "high", "xhigh"], preferredLevel: "high" },
  "deepseek-reasoner": { supported: true, levels: ["off", "low", "medium", "high"], preferredLevel: "medium" },
  "deepseek-r1": { supported: true, levels: ["off", "low", "medium", "high"], preferredLevel: "medium" },
  "gemini-2.5-pro": { supported: true, levels: ["off", "low", "medium", "high", "xhigh"], preferredLevel: "high" },
  "gemini-2.5-flash": { supported: true, levels: ["off", "low", "medium", "high"], preferredLevel: "medium" },
};
