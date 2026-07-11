import type { ProviderProfile } from "./types.js";

export function publicProfile(p: ProviderProfile) {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKeyConfigured: Boolean(p.apiKey),
  };
}

export function redactSecrets(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|authorization/i.test(k)) out[k] = "[redacted]";
      else out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}
