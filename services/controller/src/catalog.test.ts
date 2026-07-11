import test from "node:test";
import assert from "node:assert/strict";
import { CatalogService } from "./catalog.js";

const snapshot = { revision: 1, generatedAt: new Date().toISOString(), serverId: "bds", blocks: ["minecraft:stone", "my_pack:dark_oak_planks", "minecraft:dark_oak_stairs"], items: [], entities: [] };

test("catalog resolves custom namespaced ids and ranks searches", () => {
  const service = new CatalogService(); service.replace("s", snapshot);
  assert.deepEqual(service.resolve("s", "block", "my_pack:dark_oak_planks").valid, true);
  assert.equal(service.search("s", "block", "dark oak stair").matches[0].id, "minecraft:dark_oak_stairs");
});

test("catalog tokenizes multi-word queries", () => {
  const service = new CatalogService();
  service.replace("s", { ...snapshot, blocks: ["minecraft:dark_oak_stairs", "minecraft:stone"] });
  const result = service.search("s", "block", "dark oak stairs");
  assert.equal(result.matches[0].id, "minecraft:dark_oak_stairs");
  assert.ok(result.matches[0].score >= 0.8);
});

test("catalog limits results and suggests invalid ids", () => {
  const service = new CatalogService(); service.replace("s", snapshot);
  assert.ok(service.search("s", "block", "minecraft", 1).matches.length <= 1);
  assert.deepEqual(service.resolve("s", "block", "minecraft:dark_oak_stair").suggestions?.[0], "minecraft:dark_oak_stairs");
});

test("catalog replacement and clearing are session scoped", () => {
  const service = new CatalogService(); service.replace("s", snapshot);
  service.replace("s", { ...snapshot, revision: 2, blocks: ["minecraft:dirt"] });
  assert.equal(service.resolve("s", "block", "minecraft:stone").valid, false);
  service.clear("s"); assert.equal(service.search("s", "block", "dirt").revision, 0);
});

test("catalog searches thousands of identifiers locally", () => {
  const service = new CatalogService();
  const blocks = Array.from({ length: 5000 }, (_, i) => `pack:block_${i}`);
  service.replace("large", { ...snapshot, blocks });
  const start = performance.now();
  const result = service.search("large", "block", "block_4999", 8);
  assert.equal(result.matches[0].id, "pack:block_4999");
  assert.ok(performance.now() - start < 50);
});
