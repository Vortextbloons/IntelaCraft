export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** HTTP Authorization headers must be Latin-1 / ByteString-safe. */
export function sanitizeApiKey(raw: string): string {
  const key = raw.trim().replace(/^Bearer\s+/i, "");
  if (!key) throw new Error("API key is empty");
  if (/grammarly|iterable|not supported/i.test(key)) {
    throw new Error("That looks like a browser extension error, not an API key — paste the key again");
  }
  if (/[^\x20-\x7E]/.test(key)) {
    throw new Error("API key contains invalid characters — paste only the key text");
  }
  return key;
}
