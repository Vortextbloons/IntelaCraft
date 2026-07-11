import type { ReasoningCapabilities } from "./types";

export const MODES = [
  "observe_only",
  "confirm_every_change",
  "allow_low_risk",
  "builder_region",
  "trusted_administrator",
] as const;

export const PROVIDER_PRESETS = [
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    model: "gpt-5.4-mini",
    hint: "Paste key from opencode.ai/auth — models auto-load",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    model: "qwen3-coder",
    hint: "OpenCode Go subscription models",
  },
  {
    id: "openai",
    name: "OpenAI / Codex",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hint: "OpenAI API key — Codex-capable chat models preferred",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4.1-mini",
    hint: "OpenRouter key — many Codex-style models",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    hint: "Fast open models",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    hint: "Local — no key needed (use any string)",
  },
  {
    id: "custom",
    name: "Custom OpenAI-compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "local-model",
    hint: "Any /v1 chat-completions gateway",
  },
] as const;

export const WELCOME_TEXT =
  "New session. Connect a provider in the composer, pick a model from its catalog, then chat.";

export const NO_REASONING_CAPABILITIES: ReasoningCapabilities = {
  supported: false,
  levels: ["off"],
  preferredLevel: "off",
  source: "unknown",
};
