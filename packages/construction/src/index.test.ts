import assert from "node:assert/strict";
import test from "node:test";
import { buildWall, generateSemantic, previewPlacements, validateBuildPlan, validateSemanticArguments } from "./index.js";

test("wall geometry is deterministic and inclusive", () => {
  const wall=buildWall({dimension:"minecraft:overworld",from:{x:0,y:64,z:0},to:{x:2,y:64,z:0},height:2,blockType:"minecraft:stone"});
  assert.equal(wall.blocks.length,6); assert.deepEqual(wall.bounds.max,{x:2,y:65,z:0});
});
test("semantic validation rejects invalid blocks", () => {
  assert.throws(()=>generateSemantic("build.pillar",{dimension:"minecraft:overworld",position:{x:0,y:64,z:0},height:2,blockType:"stone"}));
});
test("stairs require a positive integer height before generation", () => {
  assert.deepEqual(validateSemanticArguments("build.stairs", {dimension:"minecraft:overworld",from:{x:0,y:64,z:0},to:{x:1,y:64,z:0},blockType:"minecraft:stone"}), ["height must be a positive integer"]);
});
test("roof generates continuous gable planes with a stable ridge", () => {
  const roof = generateSemantic("build.roof", {
    dimension: "minecraft:overworld",
    from: { x: 0, y: 64, z: 0 },
    to: { x: 8, y: 64, z: 4 },
    blockType: "minecraft:oak_stairs",
  });
  assert.equal(roof.blocks.length, 45);
  assert.deepEqual(roof.bounds, { min: { x: 0, y: 64, z: 0 }, max: { x: 8, y: 66, z: 4 } });
  for (const z of [0, 1, 2, 3, 4]) {
    const row = roof.blocks.filter((block) => block.position.z === z);
    assert.equal(row.length, 9);
    assert.equal(new Set(row.map((block) => block.position.x)).size, 9);
  }
});
test("build plan detects cyclic dependencies", () => {
  const result=validateBuildPlan({summary:"x",palette:[],steps:[{id:"a",summary:"a",toolName:"build.pillar",arguments:{dimension:"minecraft:overworld",position:{x:0,y:64,z:0},height:1,blockType:"minecraft:stone"},dependsOn:["b"]},{id:"b",summary:"b",toolName:"build.pillar",arguments:{dimension:"minecraft:overworld",position:{x:1,y:64,z:0},height:1,blockType:"minecraft:stone"},dependsOn:["a"]}],verification:[],estimates:{blocksChanged:2,operations:2},warnings:[]});
  assert.ok(result.issues.some(i=>i.code==="CIRCULAR_DEPENDENCY"));
});
test("preview totals material and batches", () => {
  const build=buildWall({dimension:"minecraft:overworld",from:{x:0,y:64,z:0},to:{x:1,y:64,z:0},height:1,blockType:"minecraft:stone"}); const preview=previewPlacements(build,{batchSize:1}); assert.equal(preview.materials["minecraft:stone"],2);assert.equal(preview.estimatedBatches,2);
});
