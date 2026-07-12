import { MAX_ROLLBACK_BLOCKS, regionVolume, type BuildVerification, type ExpectedWorldState, type Vec3i, type VoxelSnapshot } from "@intelacraft/shared-protocol";
import { optimizePlacements, type OptimizedOperation } from "./optimize-placements.js";
import type { BlockPlacement } from "./index.js";
const key=(p:Vec3i)=>`${p.x},${p.y},${p.z}`;
function decodeSnapshot(snapshot:VoxelSnapshot):Map<string,string>{
 if(snapshot.version!==1||!snapshot.palette.length)throw new Error("Invalid voxel snapshot metadata");const expected=regionVolume(snapshot.bounds);if(snapshot.blocks.length!==expected)throw new Error(`Invalid voxel snapshot length: expected ${expected}, got ${snapshot.blocks.length}`);const map=new Map<string,string>();let i=0;for(let y=snapshot.bounds.min.y;y<=snapshot.bounds.max.y;y++)for(let z=snapshot.bounds.min.z;z<=snapshot.bounds.max.z;z++)for(let x=snapshot.bounds.min.x;x<=snapshot.bounds.max.x;x++){const entry=snapshot.palette[snapshot.blocks[i++]];if(!entry||typeof entry.typeId!=="string")throw new Error("Voxel snapshot contains an invalid palette index");map.set(`${x},${y},${z}`,entry.typeId);}return map;
}
function contains(outer:ExpectedWorldState["bounds"],inner:ExpectedWorldState["bounds"]){return outer.min.x<=inner.min.x&&outer.min.y<=inner.min.y&&outer.min.z<=inner.min.z&&outer.max.x>=inner.max.x&&outer.max.y>=inner.max.y&&outer.max.z>=inner.max.z;}
/** Compare canonical expected state with a complete final voxel snapshot. */
export function verifyBuild(expected:ExpectedWorldState,snapshot:VoxelSnapshot):BuildVerification{
 if(snapshot.dimension!==expected.dimension)throw new Error("Snapshot dimension does not match expected state");if(!contains(snapshot.bounds,expected.bounds))throw new Error("Snapshot does not cover expected build bounds");const actual=decodeSnapshot(snapshot),wanted=new Map(expected.blocks.map(b=>[key(b.position),b])),requiredAir=new Set(expected.requiredAir.map(key)),missing:BuildVerification["missing"]=[],incorrect:BuildVerification["incorrect"]=[],unexpected:BuildVerification["unexpected"]=[];let correct=0;
 for(const block of expected.blocks){const found=actual.get(key(block.position));if(found===block.blockType)correct++;else if(found==="minecraft:air")missing.push(block);else incorrect.push({position:block.position,expected:block.blockType,actual:found??"minecraft:unavailable"});}
 for(const [position,type] of actual){if(type==="minecraft:air"||wanted.has(position))continue;const [x,y,z]=position.split(",").map(Number),p={x,y,z};if(requiredAir.has(position)||contains(expected.bounds,{min:p,max:p}))unexpected.push({position:p,blockType:type});}
 const completionPercent=expected.blocks.length===0?100:Math.round(correct/expected.blocks.length*10000)/100;return {expectedBlocks:expected.blocks.length,correctBlocks:correct,missing,incorrect,unexpected,completionPercent};
}
/** Materialize one bounded corrective pass; caller must submit it through normal approval. */
export function createRepairOperations(expected:ExpectedWorldState,verification:BuildVerification):OptimizedOperation[]{
 const repairs=new Map<string,BlockPlacement>();for(const b of verification.missing)repairs.set(key(b.position),b);for(const b of verification.incorrect)repairs.set(key(b.position),{position:b.position,blockType:b.expected});for(const b of verification.unexpected)repairs.set(key(b.position),{position:b.position,blockType:"minecraft:air"});if(repairs.size>MAX_ROLLBACK_BLOCKS)throw new Error(`Repair requires ${repairs.size} blocks, exceeding rollback limit ${MAX_ROLLBACK_BLOCKS}`);return optimizePlacements(expected.dimension,[...repairs.values()]);
}
