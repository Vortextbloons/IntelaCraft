import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { DiscoveredModel } from "@intelacraft/shared-protocol";
import { getReasoningCapabilities } from "./reasoning.js";
import type { ProviderProfile } from "./types.js";

function endpoint(base: string, path: string) {
  return `${base.replace(/\/$/, "")}${path}`;
}

async function request(profile: ProviderProfile, path: string, init: RequestInit = {}) {
  const key = String(profile.apiKey ?? "")
    .trim()
    .replace(/^Bearer\s+/i, "");
  if (!key || /[^\x20-\x7E]/.test(key)) {
    throw new Error("Provider API key is invalid — reconnect and paste a clean key");
  }
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${key}`);
  const r = await fetch(endpoint(profile.baseUrl, path), {
    ...init,
    headers,
    signal: AbortSignal.timeout(45000),
  });
  const text = await r.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!r.ok) throw new Error(`Provider ${r.status}: ${data?.error?.message ?? "request failed"}`);
  return data;
}

export async function discoverModels(profile: ProviderProfile): Promise<DiscoveredModel[]> {
  const data = await request(profile, "/models");
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const ids = rows
    .map((x: any) => (typeof x === "string" ? x : x?.id))
    .filter((x: any) => typeof x === "string" && x.length > 0);
  const unique = [...new Set(ids as string[])];

  // Look up Pi's built-in catalog for real capabilities
  let builtinModels: Map<string, { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> }> | undefined;
  try {
    const auth = AuthStorage.inMemory();
    const registry = ModelRegistry.inMemory(auth);
    registry.refresh();
    const allBuiltin = registry.getAll();
    builtinModels = new Map();
    for (const id of unique) {
      const m = allBuiltin.find((bm) => bm.id === id);
      if (m) builtinModels.set(id, { reasoning: m.reasoning, thinkingLevelMap: m.thinkingLevelMap });
    }
  } catch {
    /* best-effort */
  }

  const rank = (id: string) => {
    const s = id.toLowerCase();
    if (s.includes("codex")) return 0;
    if (s.includes("coder") || s.includes("code")) return 1;
    if (s.includes("mini") || s.includes("flash") || s.includes("haiku")) return 2;
    return 3;
  };
  unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return unique.map((id) => ({
    id,
    name: id,
    reasoning: getReasoningCapabilities(id, builtinModels?.get(id), profile),
  }));
}

export async function testProvider(
  profile: ProviderProfile,
): Promise<{ ok: true; model: string; toolCalling: boolean; models: DiscoveredModel[] }> {
  let models: DiscoveredModel[] = [];
  try {
    models = await discoverModels(profile);
  } catch {
    /* some gateways omit /models */
  }

  let toolCalling = false;
  try {
    const probe = async (toolChoice: unknown) => {
      const toolProbe = await request(profile, "/chat/completions", {
        method: "POST",
        body: JSON.stringify({
        model: profile.model,
        messages: [
          {
            role: "user",
            content: "Call the ping tool with message OK. Do not reply with plain text.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "ping",
              description: "Acknowledge connectivity",
              parameters: {
                type: "object",
                properties: { message: { type: "string" } },
                required: ["message"],
              },
            },
          },
        ],
        tool_choice: toolChoice,
        max_tokens: 256,
        }),
      });
      const choice = Array.isArray(toolProbe.choices) ? toolProbe.choices[0] : null;
      const msg = choice?.message;
      return Boolean(
        (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) ||
          msg?.function_call ||
          choice?.finish_reason === "tool_calls",
      );
    };
    // Gateways differ in their OpenAI-compatible `tool_choice` support. Try
    // the three forms seen in production before concluding that a model did
    // not return a native structured call. In particular, some providers
    // accept `required` but reject a named function choice.
    try {
      toolCalling = await probe({ type: "function", function: { name: "ping" } });
    } catch {
      toolCalling = false;
    }
    if (!toolCalling) {
      try {
        toolCalling = await probe("required");
      } catch {
        toolCalling = false;
      }
    }
    if (!toolCalling) toolCalling = await probe("auto");
  } catch {
    toolCalling = false;
  }

  if (!toolCalling) {
    const data = await request(profile, "/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: "user", content: "Reply OK" }],
        max_tokens: 8,
      }),
    });
    if (!Array.isArray(data.choices)) {
      throw new Error(
        "Provider returned no choices — this endpoint may require the Responses API (Codex-only models). Pick a chat-completions model.",
      );
    }
  }

  return { ok: true, model: profile.model, toolCalling, models };
}
