import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";
import {
  clampThinkingLevel,
  buildSystemPrompt,
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
  it("falls back to auto tool choice when a gateway rejects forced calls", async () => {
    const requests: unknown[] = [];
    const gateway = createServer(async (req, res) => {
      if (req.url === "/models") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests.push(parsed.tool_choice);
      res.setHeader("Content-Type", "application/json");
      if (parsed.tool_choice !== "auto") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "forced calls unsupported" } }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name: "ping", arguments: "{}" } }] } }] }));
    });
    await new Promise<void>((resolve) => gateway.listen(0, resolve));
    const address = gateway.address();
    assert.ok(address && typeof address === "object");
    try {
      const result = await testProvider({ ...p, baseUrl: `http://127.0.0.1:${address.port}`, model: "gateway-model" });
      assert.equal(result.toolCalling, true);
      assert.deepEqual(requests, [{ type: "function", function: { name: "ping" } }, "required", "auto"]);
    } finally {
      await new Promise<void>((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve()));
    }
  });
  it("accepts gateways that require the portable required tool choice", async () => {
    const requests: unknown[] = [];
    const gateway = createServer(async (req, res) => {
      if (req.url === "/models") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests.push(parsed.tool_choice);
      res.setHeader("Content-Type", "application/json");
      if (parsed.tool_choice !== "required") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "only required is supported" } }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: { name: "ping", arguments: "{}" } }] } }] }));
    });
    await new Promise<void>((resolve) => gateway.listen(0, resolve));
    const address = gateway.address();
    assert.ok(address && typeof address === "object");
    try {
      const result = await testProvider({ ...p, baseUrl: `http://127.0.0.1:${address.port}`, model: "required-model" });
      assert.equal(result.toolCalling, true);
      assert.deepEqual(requests, [{ type: "function", function: { name: "ping" } }, "required"]);
    } finally {
      await new Promise<void>((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve()));
    }
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
  it("accepts direct mutation metadata and normalizes native inspection aliases", () => {
    const plan = normalizePlan({
      summary: "Build and verify",
      actions: [{ id: "details", toolName: "world.place_blocks", summary: "Place details", dependsOn: ["walls"], arguments: {
        dimension: "minecraft:overworld", captureRollback: true,
        blocks: [{ position: { x: 0, y: 64, z: 0 }, blockType: "minecraft:torch" }],
      } }],
      verification: [{ toolName: "inspect_region", summary: "Verify", arguments: { dimension: "minecraft:overworld" } }],
    }, "build a house");
    assert.equal(plan.actions[0].id, "details");
    assert.deepEqual(plan.actions[0].dependsOn, ["walls"]);
    assert.equal(plan.verification[0].toolName, "inspect.region");
  });
  it("requires structured native tool calls and anchors Agent builds to inspection results", () => {
    const prompt = buildSystemPrompt();
    assert.match(prompt, /Always finish every turn by calling the submit_plan tool exactly once/);
    assert.match(prompt, /Never write XML, tags such as <tool_call>/);
    assert.match(prompt, /use those exact integer coordinates as the build anchor/);
  });
});
