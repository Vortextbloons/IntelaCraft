import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";
import {
  clampThinkingLevel,
  discoverModels,
  getReasoningCapabilities,
  normalizePlan,
  planRequest,
  testProvider,
  type ProviderProfile,
} from "./index.js";

const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  let parsed: any = {};
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = {};
  }
  if (parsed.model === "no-tools" && Array.isArray(parsed.tools) && parsed.tools.length) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: "tool_use_failed" } }));
    return;
  }
  if (Array.isArray(parsed.tools) && parsed.tools.length) {
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "ping", arguments: '{"message":"OK"}' },
                },
              ],
            },
          },
        ],
      }),
    );
    return;
  }
  res.end(
    JSON.stringify({
      choices: [{ message: { content: "OK" } }],
    }),
  );
});
await new Promise<void>((r) => server.listen(0, r));
const a = server.address();
assert.ok(a && typeof a === "object");
const p: ProviderProfile = {
  id: "p",
  name: "P",
  baseUrl: `http://127.0.0.1:${a.port}/v1`,
  apiKey: "secret",
  model: "test-model",
};
after(() => server.close());

describe("IntelaCraft Pi extension", () => {
  it("discovers and tests models via OpenAI-compatible HTTP", async () => {
    const models = await discoverModels(p);
    assert.equal(models.length, 1);
    assert.equal(models[0].id, "test-model");
    assert.equal(models[0].reasoning.supported, true);
    assert.equal(models[0].reasoning.preferredLevel, "medium");
    const result = await testProvider(p);
    assert.equal(result.ok, true);
    assert.equal(result.toolCalling, true);
  });
  it("reports models that can chat but cannot call functions", async () => {
    const result = await testProvider({ ...p, model: "no-tools" });
    assert.equal(result.ok, true);
    assert.equal(result.toolCalling, false);
  });
  it("getReasoningCapabilities returns override for known models", () => {
    const caps = getReasoningCapabilities("o3");
    assert.equal(caps.supported, true);
    assert.ok(caps.levels.includes("xhigh"));
    assert.ok(caps.levels.includes("max"));
    assert.equal(caps.source, "override");
  });
  it("getReasoningCapabilities exposes portable reasoning controls for unrecognized models", () => {
    const caps = getReasoningCapabilities("some-random-model");
    assert.equal(caps.supported, true);
    assert.deepEqual(caps.levels, ["off", "minimal", "low", "medium", "high"]);
    assert.equal(caps.preferredLevel, "medium");
    assert.equal(caps.source, "unknown");
  });
  it("does not add reasoning effort to Groq's catalog-only models", () => {
    const caps = getReasoningCapabilities("llama-3.3-70b-versatile", undefined, {
      id: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
    });
    assert.equal(caps.supported, false);
    assert.deepEqual(caps.levels, ["off"]);
    assert.equal(clampThinkingLevel("llama-3.3-70b-versatile", "high", undefined, {
      id: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
    }), "off");
  });
  it("clampThinkingLevel clamps to supported levels", () => {
    assert.equal(clampThinkingLevel("o3", "off"), "off");
    assert.equal(clampThinkingLevel("o3", "high"), "high");
    assert.equal(clampThinkingLevel("o3", "xhigh"), "xhigh");
    assert.equal(clampThinkingLevel("o3", "max"), "max");
    assert.equal(clampThinkingLevel("some-random-model", "high"), "high");
  });
  it("clampThinkingLevel finds nearest level when exact not available", () => {
    assert.equal(clampThinkingLevel("o3-mini", "xhigh"), "high");
    assert.equal(clampThinkingLevel("o3-mini", "max"), "high");
  });
  it("fallback planRequest suggests inspect.players for online asks", async () => {
    const plan = await planRequest(p, "who is online", {});
    assert.equal(plan.inspection[0].toolName, "inspect.players");
  });
  it("normalizes greeting plans with missing arrays", () => {
    const plan = normalizePlan({ summary: "Hello!" }, "hi");
    assert.equal(plan.summary, "Hello!");
    assert.deepEqual(plan.inspection, []);
    assert.deepEqual(plan.actions, []);
    assert.deepEqual(plan.verification, []);
  });
});
