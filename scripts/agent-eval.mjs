import assert from "node:assert/strict";
import { normalizePlan, planRequest } from "../packages/pi-extension/dist/index.js";
import { validateToolArguments } from "../packages/shared-protocol/dist/index.js";

const profile = { id: "eval", name: "eval", baseUrl: "http://invalid", apiKey: "x", model: "eval" };
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) }); }
}

await check("read request selects players inspection", async () => {
  const plan = await planRequest(profile, "who is online?", {});
  assert.equal(plan.inspection[0]?.toolName, "inspect.players");
});
await check("greeting does not invent world work", () => {
  const plan = normalizePlan({ summary: "Hello" }, "hello");
  assert.equal(plan.actions.length + plan.inspection.length, 0);
});
await check("oversized fill is rejected", () => {
  assert.equal(validateToolArguments("world.fill_blocks", {
    dimension: "minecraft:overworld",
    region: { min: { x: 0, y: 0, z: 0 }, max: { x: 99, y: 99, z: 99 } },
    blockType: "minecraft:stone", captureRollback: true,
  }).ok, false);
});
await check("bounded rollback fill is accepted", () => {
  assert.equal(validateToolArguments("world.fill_blocks", {
    dimension: "minecraft:overworld",
    region: { min: { x: 0, y: 64, z: 0 }, max: { x: 1, y: 64, z: 1 } },
    blockType: "minecraft:stone", captureRollback: true,
  }).ok, true);
});

for (const row of checks) console.log(`${row.ok ? "PASS" : "FAIL"} ${row.name}${row.error ? `: ${row.error}` : ""}`);
const passed = checks.filter((row) => row.ok).length;
console.log(`\nAgent eval: ${passed}/${checks.length} passed`);
if (passed !== checks.length) process.exitCode = 1;
