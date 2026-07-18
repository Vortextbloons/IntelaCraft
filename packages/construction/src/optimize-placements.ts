import { DEFAULT_BATCH_SIZE, MAX_PLACE_BLOCKS, MAX_ROLLBACK_BLOCKS, type DimensionId, type FillBlocksArgs, type PlaceBlocksArgs, type Vec3i } from "@intelacraft/shared-protocol";
import type { BlockPlacement } from "./index.js";

export type OptimizedOperation={toolName:"world.fill_blocks";arguments:FillBlocksArgs}|{toolName:"world.place_blocks";arguments:PlaceBlocksArgs};
const key=(p:Vec3i)=>`${p.x},${p.y},${p.z}`;
const hasStates=(block:BlockPlacement)=>!!block.states&&Object.keys(block.states).length>0;

/** Deduplicate, skip matching world blocks, and compact straight X runs into fills. */
export function optimizePlacements(dimension:DimensionId,input:BlockPlacement[],existing?:ReadonlyMap<string,string>):OptimizedOperation[]{
 const unique=new Map<string,BlockPlacement>();for(const block of input)unique.set(key(block.position),block);const pending=[...unique.values()].filter(b=>hasStates(b)||existing?.get(key(b.position))!==b.blockType).sort((a,b)=>a.blockType.localeCompare(b.blockType)||Number(hasStates(a))-Number(hasStates(b))||a.position.y-b.position.y||a.position.z-b.position.z||a.position.x-b.position.x),fills:OptimizedOperation[]=[],details:BlockPlacement[]=[];
 for(let i=0;i<pending.length;){const first=pending[i];if(hasStates(first)){details.push(first);i++;continue;}let end=i+1;while(end<pending.length&&!hasStates(pending[end])&&pending[end].blockType===first.blockType&&pending[end].position.y===first.position.y&&pending[end].position.z===first.position.z&&pending[end].position.x===pending[end-1].position.x+1)end++;if(end-i>=2)fills.push({toolName:"world.fill_blocks",arguments:{dimension,region:{min:first.position,max:pending[end-1].position},blockType:first.blockType,batchSize:DEFAULT_BATCH_SIZE,captureRollback:true}});else details.push(first);i=end;}
 const limit=Math.min(MAX_PLACE_BLOCKS,MAX_ROLLBACK_BLOCKS);for(let i=0;i<details.length;i+=limit)fills.push({toolName:"world.place_blocks",arguments:{dimension,blocks:details.slice(i,i+limit),batchSize:DEFAULT_BATCH_SIZE,captureRollback:true}});return fills;
}
