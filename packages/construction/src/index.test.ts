import assert from "node:assert/strict";
import test from "node:test";
import { buildWall, compileBuildSpec, createBuildPhases, createRepairOperations, generateSemantic, optimizePlacements, previewPlacements, validateBuildPlan, validateSemanticArguments, verifyBuild } from "./index.js";

const cottage = { version:1 as const,name:"Cottage",type:"house" as const,location:{dimension:"minecraft:overworld" as const,anchor:{x:10,y:64,z:20},facing:"north" as const},size:{width:7,depth:5,height:6,floors:1},style:"default",palette:{foundation:"minecraft:stone",primary:"minecraft:oak_planks",roof:"minecraft:oak_stairs"},features:["foundation" as const,"door" as const],terrainPolicy:"adapt" as const,interiorPolicy:"basic" as const,symmetry:"partial" as const };
test("BuildSpec compilation is deterministic and creates the facing door",()=>{const one=compileBuildSpec(cottage),two=compileBuildSpec(structuredClone(cottage));assert.deepEqual(one,two);assert.equal(one.version,1);assert.equal(one.materials["minecraft:stone"],35);assert.ok(one.requiredAir.some(p=>p.x===13&&p.y===65&&p.z===20));assert.equal(one.blocks.some(b=>b.position.x===13&&b.position.y===65&&b.position.z===20),false);});
test("east-facing compilation rotates the footprint",()=>{const state=compileBuildSpec({...cottage,location:{...cottage.location,facing:"east"}});assert.equal(state.bounds.max.x-state.bounds.min.x+1,5);assert.equal(state.bounds.max.z-state.bounds.min.z+1,7);});
test("compiler rejects impossible dimensions",()=>{assert.throws(()=>compileBuildSpec({...cottage,size:{...cottage.size,width:2}}),/allow an interior/);});
test("compiler applies style proportions and requested architectural features",()=>{const spec={...cottage,style:"modern",size:{width:9,depth:7,height:8,floors:2},palette:{...cottage.palette,glass:"minecraft:glass",trim:"minecraft:cobblestone"},features:["foundation","door","windows","stairs","balcony","chimney","porch","interior_lighting","basic_furniture"] as any};const result=compileBuildSpec(spec);assert.ok(result.materials["minecraft:glass"]>0);assert.ok(result.materials["minecraft:torch"]>0);assert.ok(result.bounds.min.z<spec.location.anchor.z);assert.ok(result.bounds.max.y>=spec.location.anchor.y+spec.size.height+1);assert.deepEqual(result,compileBuildSpec(structuredClone(spec)));});
test("unknown styles deterministically fall back to default proportions",()=>{assert.deepEqual(compileBuildSpec({...cottage,style:"unknown-style"}),compileBuildSpec({...cottage,style:"default"}));});
test("bridge and wall types use specialized geometry",()=>{const bridge=compileBuildSpec({...cottage,type:"bridge",size:{width:11,depth:3,height:3,floors:1},features:["foundation"]});assert.equal(bridge.bounds.max.y-bridge.bounds.min.y,2);assert.equal(bridge.materials["minecraft:oak_planks"],77);const wall=compileBuildSpec({...cottage,type:"wall",size:{width:9,depth:1,height:4,floors:1},features:["door"]});assert.ok(wall.requiredAir.length>=2);assert.equal(wall.bounds.max.x,wall.bounds.min.x);});
test("incompatible type features fail before compilation",()=>{assert.throws(()=>compileBuildSpec({...cottage,type:"bridge",features:["chimney"]}),/INCOMPATIBLE_FEATURE/);});
test("terrain policies deterministically adapt, flatten, preserve, and raise foundations",()=>{const columns=[{x:10,z:20,height:61},{x:11,z:20,height:63},{x:12,z:20,height:66}];const adapt=compileBuildSpec({...cottage,terrainPolicy:"adapt"},{terrain:{columns}});assert.ok(adapt.blocks.some(b=>b.position.x===10&&b.position.y===62&&b.position.z===20&&b.blockType==="minecraft:stone"));const preserve=compileBuildSpec({...cottage,terrainPolicy:"preserve"},{terrain:{columns}});assert.equal(preserve.blocks.some(b=>b.position.y<64),false);const raised=compileBuildSpec({...cottage,terrainPolicy:"raise_foundation"},{terrain:{columns}});assert.equal(raised.bounds.min.y,67);const flat=compileBuildSpec({...cottage,features:["door"],terrainPolicy:"flatten"},{terrain:{columns}});assert.equal(flat.blocks.filter(b=>b.position.y===64&&b.blockType==="minecraft:stone").length,35);});
test("optimizer compacts runs, skips correct blocks, and captures rollback",()=>{const blocks=[0,1,2].map(x=>({position:{x,y:64,z:0},blockType:"minecraft:stone"}));const compact=optimizePlacements("minecraft:overworld",blocks);assert.equal(compact[0].toolName,"world.fill_blocks");assert.ok(compact.every(o=>o.arguments.captureRollback===true));const skipped=optimizePlacements("minecraft:overworld",blocks,new Map([["1,64,0","minecraft:stone"]]));assert.equal(skipped.reduce((n,o)=>n+(o.toolName==="world.fill_blocks"?o.arguments.region.max.x-o.arguments.region.min.x+1:o.arguments.blocks.length),0),2);});
test("build phases preserve the fixed dependency order",()=>{const phases=createBuildPhases(compileBuildSpec(cottage));assert.equal(phases.length,9);assert.deepEqual(phases[4].dependsOn,["floors_walls"]);assert.ok(phases[0].estimatedBlocks>0);assert.ok(phases[1].operations.length>0);assert.equal(phases[8].operations.length,0);});
test("verification classifies mismatches and creates minimal repairs",()=>{const expected={version:1 as const,dimension:"minecraft:overworld" as const,bounds:{min:{x:0,y:0,z:0},max:{x:2,y:0,z:0}},blocks:[{position:{x:0,y:0,z:0},blockType:"minecraft:stone"},{position:{x:1,y:0,z:0},blockType:"minecraft:stone"}],requiredAir:[{x:2,y:0,z:0}],materials:{"minecraft:stone":2}};const snapshot={version:1 as const,dimension:expected.dimension,bounds:expected.bounds,palette:[{typeId:"minecraft:air"},{typeId:"minecraft:dirt"},{typeId:"minecraft:glass"}],blocks:[0,1,2],indexType:"uint16" as const,capturedAt:new Date(0).toISOString()};const result=verifyBuild(expected,snapshot);assert.equal(result.completionPercent,0);assert.equal(result.missing.length,1);assert.equal(result.incorrect.length,1);assert.equal(result.unexpected.length,1);const operations=createRepairOperations(expected,result);assert.equal(operations.reduce((n,o)=>n+(o.toolName==="world.place_blocks"?o.arguments.blocks.length:o.arguments.region.max.x-o.arguments.region.min.x+1),0),3);assert.ok(operations.every(o=>o.arguments.captureRollback));});
test("verification rejects incomplete snapshots",()=>{const expected=compileBuildSpec(cottage);assert.throws(()=>verifyBuild(expected,{version:1,dimension:expected.dimension,bounds:expected.bounds,palette:[{typeId:"minecraft:air"}],blocks:[],indexType:"uint16",capturedAt:new Date(0).toISOString()}),/snapshot length/);});

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
