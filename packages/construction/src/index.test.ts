import assert from "node:assert/strict";
import test from "node:test";
import { buildWall, generateSemantic, previewPlacements, validateBuildPlan } from "./index.js";

test("wall geometry is deterministic and inclusive", () => {
  const wall=buildWall({dimension:"minecraft:overworld",from:{x:0,y:64,z:0},to:{x:2,y:64,z:0},height:2,blockType:"minecraft:stone"});
  assert.equal(wall.blocks.length,6); assert.deepEqual(wall.bounds.max,{x:2,y:65,z:0});
});
test("semantic validation rejects invalid blocks", () => {
  assert.throws(()=>generateSemantic("build.pillar",{dimension:"minecraft:overworld",position:{x:0,y:64,z:0},height:2,blockType:"stone"}));
});
test("build plan detects cyclic dependencies", () => {
  const result=validateBuildPlan({summary:"x",palette:[],steps:[{id:"a",summary:"a",toolName:"build.pillar",arguments:{dimension:"minecraft:overworld",position:{x:0,y:64,z:0},height:1,blockType:"minecraft:stone"},dependsOn:["b"]},{id:"b",summary:"b",toolName:"build.pillar",arguments:{dimension:"minecraft:overworld",position:{x:1,y:64,z:0},height:1,blockType:"minecraft:stone"},dependsOn:["a"]}],verification:[],estimates:{blocksChanged:2,operations:2},warnings:[]});
  assert.ok(result.issues.some(i=>i.code==="CIRCULAR_DEPENDENCY"));
});
test("preview totals material and batches", () => {
  const build=buildWall({dimension:"minecraft:overworld",from:{x:0,y:64,z:0},to:{x:1,y:64,z:0},height:1,blockType:"minecraft:stone"}); const preview=previewPlacements(build,{batchSize:1}); assert.equal(preview.materials["minecraft:stone"],2);assert.equal(preview.estimatedBatches,2);
});
