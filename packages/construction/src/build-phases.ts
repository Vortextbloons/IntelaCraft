import type { ExpectedWorldState } from "@intelacraft/shared-protocol";
import { optimizePlacements, type OptimizedOperation } from "./optimize-placements.js";
import type { BlockPlacement } from "./index.js";
export interface BuildPhase{id:string;name:string;dependsOn:string[];operations:OptimizedOperation[];estimatedBlocks:number}
const definitions=[['site_preparation','Site preparation'],['foundation','Foundation'],['structural_frame','Structural frame'],['floors_walls','Floors and walls'],['roof','Roof'],['doors_windows','Doors and windows'],['exterior_details','Exterior details'],['interior','Interior'],['verification','Verification']] as const;
/** Produces the fixed dependency chain while keeping optimization inside phase boundaries. */
export function createBuildPhases(state:ExpectedWorldState,existing?:ReadonlyMap<string,string>):BuildPhase[]{
 const groups=new Map<string,BlockPlacement[]>(definitions.map(([id])=>[id,[]]));for(const p of state.requiredAir)groups.get('site_preparation')!.push({position:p,blockType:'minecraft:air'});for(const b of state.blocks){const id=b.position.y===state.bounds.min.y?'foundation':b.position.y>=state.bounds.max.y?'roof':'floors_walls';groups.get(id)!.push(b);}let previous:string|undefined;return definitions.map(([id,name])=>{const blocks=groups.get(id)!;const phase={id,name,dependsOn:previous?[previous]:[],operations:id==='verification'?[]:optimizePlacements(state.dimension,blocks,existing),estimatedBlocks:blocks.length};previous=id;return phase;});
}
