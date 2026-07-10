import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";
import {
  discoverModels,
  normalizePlan,
  planRequest,
  testProvider,
  type ProviderProfile,
} from "./index.js";

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
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
    assert.deepEqual(await discoverModels(p), ["test-model"]);
    assert.equal((await testProvider(p)).ok, true);
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
