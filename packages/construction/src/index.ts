import { normalizeRegion, type DimensionId, type RegionBounds, type Vec3i } from "@intelacraft/shared-protocol";

export interface BlockPlacement { position: Vec3i; blockType: string; }
export interface BuildWallArgs { dimension: DimensionId; from: Vec3i; to: Vec3i; height: number; blockType: string; thickness?: number; }
export interface BuildFloorArgs { dimension: DimensionId; from: Vec3i; to: Vec3i; blockType: string; thickness?: number; }
export interface BuildPillarArgs { dimension: DimensionId; position: Vec3i; height: number; blockType: string; }
export interface BuildRoofArgs { dimension: DimensionId; from: Vec3i; to: Vec3i; blockType: string; }
export interface GeneratedBuild { dimension: DimensionId; blocks: BlockPlacement[]; bounds: RegionBounds; }

function generated(dimension: DimensionId, blocks: BlockPlacement[]): GeneratedBuild {
  if (!blocks.length) throw new Error("Geometry generated no blocks");
  const points=blocks.map(b=>b.position); const bounds={min:{x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),z:Math.min(...points.map(p=>p.z))},max:{x:Math.max(...points.map(p=>p.x)),y:Math.max(...points.map(p=>p.y)),z:Math.max(...points.map(p=>p.z))}};
  return {dimension,blocks,bounds};
}
/** Deterministic inclusive wall between two horizontal endpoints. */
export function buildWall(args: BuildWallArgs): GeneratedBuild { if (!Number.isInteger(args.height)||args.height<1) throw new Error("height must be a positive integer"); const thickness=args.thickness??1; if(!Number.isInteger(thickness)||thickness<1) throw new Error("thickness must be a positive integer"); const blocks:BlockPlacement[]=[]; const dx=Math.abs(args.to.x-args.from.x), dz=Math.abs(args.to.z-args.from.z); if(dx && dz) throw new Error("wall endpoints must align on X or Z"); for(let y=0;y<args.height;y++) for(let t=0;t<thickness;t++) for(let n=0;n<=Math.max(dx,dz);n++) blocks.push({position:{x:args.from.x+(dx?n:0),y:args.from.y+y,z:args.from.z+(dz?n:0)+(dx?t:0)},blockType:args.blockType}); return generated(args.dimension,blocks); }
export function buildFloor(args: BuildFloorArgs): GeneratedBuild { const r=normalizeRegion(args.from,args.to), thickness=args.thickness??1; if(!Number.isInteger(thickness)||thickness<1) throw new Error("thickness must be a positive integer"); const blocks:BlockPlacement[]=[]; for(let y=0;y<thickness;y++) for(let x=r.min.x;x<=r.max.x;x++) for(let z=r.min.z;z<=r.max.z;z++) blocks.push({position:{x,y:r.min.y-y,z},blockType:args.blockType}); return generated(args.dimension,blocks); }
export function buildPillar(args: BuildPillarArgs): GeneratedBuild { if(!Number.isInteger(args.height)||args.height<1) throw new Error("height must be a positive integer"); return generated(args.dimension,Array.from({length:args.height},(_,i)=>({position:{x:args.position.x,y:args.position.y+i,z:args.position.z},blockType:args.blockType}))); }
/** Builds continuous gable planes with a ridge along the longer footprint axis. */
export function buildRoof(args: BuildRoofArgs): GeneratedBuild {
  const r = normalizeRegion(args.from, args.to);
  const spanX = r.max.x - r.min.x;
  const spanZ = r.max.z - r.min.z;
  const blocks: BlockPlacement[] = [];
  if (spanZ <= spanX) {
    for (let z = r.min.z; z <= r.max.z; z++) {
      const rise = Math.min(z - r.min.z, r.max.z - z);
      for (let x = r.min.x; x <= r.max.x; x++) {
        blocks.push({ position: { x, y: r.min.y + rise, z }, blockType: args.blockType });
      }
    }
  } else {
    for (let x = r.min.x; x <= r.max.x; x++) {
      const rise = Math.min(x - r.min.x, r.max.x - x);
      for (let z = r.min.z; z <= r.max.z; z++) {
        blocks.push({ position: { x, y: r.min.y + rise, z }, blockType: args.blockType });
      }
    }
  }
  return generated(args.dimension, blocks);
}
export function materialTotals(blocks: BlockPlacement[]): Record<string,number> { return blocks.reduce<Record<string,number>>((totals,b)=>{totals[b.blockType]=(totals[b.blockType]??0)+1;return totals;},{}); }

export type SemanticToolName = "build.wall"|"build.floor"|"build.pillar"|"build.doorway"|"build.window"|"build.roof"|"build.stairs"|"build.room"|"build.path";
const BLOCK_ID = /^minecraft:[a-z0-9_.-]+$/;
function isVec(value: unknown): value is Vec3i { return !!value && typeof value === "object" && Number.isInteger((value as Vec3i).x) && Number.isInteger((value as Vec3i).y) && Number.isInteger((value as Vec3i).z); }
/** Strict shared semantic-tool validation, used before both preview and execution. */
export function validateSemanticArguments(tool: SemanticToolName, args: Record<string, unknown>): string[] {
  const errors:string[]=[]; if(!["minecraft:overworld","minecraft:nether","minecraft:the_end"].includes(String(args.dimension))) errors.push("dimension must be a supported Minecraft dimension"); if(typeof args.blockType!=="string"||!BLOCK_ID.test(args.blockType))errors.push("blockType must be a namespaced Minecraft block id");
  if(tool==="build.pillar") { if(!isVec(args.position))errors.push("position must be integer x,y,z"); } else { if(!isVec(args.from)||!isVec(args.to))errors.push("from and to must be integer x,y,z"); }
  if(["build.wall","build.pillar","build.room","build.doorway","build.window","build.stairs"].includes(tool) && (!Number.isInteger(args.height)||Number(args.height)<1)) errors.push("height must be a positive integer");
  if(args.thickness!==undefined&&(!Number.isInteger(args.thickness)||Number(args.thickness)<1))errors.push("thickness must be a positive integer"); if(args.width!==undefined&&(!Number.isInteger(args.width)||Number(args.width)<1))errors.push("width must be a positive integer"); return errors;
}
/** One pure dispatch point shared by preview and controller execution. */
export function generateSemantic(tool: SemanticToolName, args: Record<string, unknown>): GeneratedBuild {
  const errors=validateSemanticArguments(tool,args); if(errors.length) throw new Error(errors.join("; "));
  const a=args as any;
  if(tool==="build.wall") return buildWall(a); if(tool==="build.floor"||tool==="build.path") return buildFloor(a); if(tool==="build.pillar") return buildPillar(a);
  if(tool==="build.room") { const floor=buildFloor(a); const r=normalizeRegion(a.from,a.to); const height=a.height; const blocks=[...floor.blocks]; for(const [from,to] of [[r.min,{x:r.max.x,y:r.min.y,z:r.min.z}],[{x:r.min.x,y:r.min.y,z:r.max.z},r.max],[r.min,{x:r.min.x,y:r.min.y,z:r.max.z}],[{x:r.max.x,y:r.min.y,z:r.min.z},r.max]] as any) blocks.push(...buildWall({...a,from,to,height}).blocks); return generated(a.dimension, dedupe(blocks)); }
  if(tool==="build.stairs") { const blocks:BlockPlacement[]=[]; for(let i=0;i<a.height;i++) for(let w=0;w<(a.width??1);w++) blocks.push({position:{x:a.from.x+i,y:a.from.y+i,z:a.from.z+w},blockType:a.blockType}); return generated(a.dimension,blocks); }
  if(tool==="build.roof") return buildRoof(a);
  if(tool==="build.doorway"||tool==="build.window") { const wall=buildWall({...a,height:a.height??(tool==="build.doorway"?3:2)}); const width=a.width??1; const opening=wall.blocks.filter(b=>!(b.position.x>=a.from.x&&b.position.x<a.from.x+width&&b.position.y>=a.from.y+(tool==="build.window"?1:0))); return generated(a.dimension,opening); }
  throw new Error(`Unsupported semantic tool ${tool}`);
}
function dedupe(blocks:BlockPlacement[]) { const seen=new Map<string,BlockPlacement>(); for(const b of blocks)seen.set(`${b.position.x},${b.position.y},${b.position.z}`,b); return [...seen.values()]; }

export interface WorldSnapshot { capturedAt:string; dimension:DimensionId; blocks?:Map<string,string>; collisions?:Array<{position?:Vec3i;type:string}>; protectedRegions?:Array<{dimension:DimensionId;region:RegionBounds}>; }
export interface BuildPreview { bounds:RegionBounds; generatedBlocks:number; blocksAdded:number; blocksReplaced:number; blocksRemoved:number; protectedConflicts:RegionBounds[]; collisions:Array<{position?:Vec3i;type:string}>; rollbackCoverage:number; estimatedBatches:number; warnings:string[]; materials:Record<string,number>; snapshotCapturedAt?:string; }
export function previewPlacements(build:GeneratedBuild, context:{ existing?: Map<string,string>; protectedRegions?:Array<{dimension:DimensionId;region:RegionBounds}>; batchSize?:number; snapshot?:WorldSnapshot }={}):BuildPreview { let added=0,replaced=0,removed=0; const protectedRegions=context.snapshot?.protectedRegions??context.protectedRegions??[]; const conflicts=protectedRegions.filter(p=>p.dimension===build.dimension&&build.blocks.some(b=>b.position.x>=p.region.min.x&&b.position.x<=p.region.max.x&&b.position.y>=p.region.min.y&&b.position.y<=p.region.max.y&&b.position.z>=p.region.min.z&&b.position.z<=p.region.max.z)).map(p=>p.region); const existing=context.snapshot?.blocks??context.existing; for(const b of build.blocks){const old=existing?.get(`${b.position.x},${b.position.y},${b.position.z}`)??"minecraft:air";if(b.blockType==="minecraft:air"&&old!=="minecraft:air")removed++;else if(old==="minecraft:air")added++;else if(old!==b.blockType)replaced++;} const collisions=context.snapshot?.collisions??[]; return {bounds:build.bounds,generatedBlocks:build.blocks.length,blocksAdded:added,blocksReplaced:replaced,blocksRemoved:removed,protectedConflicts:conflicts,collisions,rollbackCoverage:Math.min(1,8192/build.blocks.length),estimatedBatches:Math.ceil(build.blocks.length/(context.batchSize??512)),warnings:[...(conflicts.length?["Protected-region conflict"]:[]),...(collisions.length?[`${collisions.length} live collision(s)`]:[]),...(build.blocks.length>8192?["Rollback capture is partial"]:[])],materials:materialTotals(build.blocks),snapshotCapturedAt:context.snapshot?.capturedAt}; }

export interface BuildStep { id:string; summary:string; toolName:SemanticToolName; arguments:Record<string,unknown>; dependsOn?:string[]; risk?:string; }
export interface BuildPlan { summary:string; anchor?:{dimension:DimensionId;position:Vec3i;facing?:string}; bounds?:RegionBounds; palette:Array<{role:string;blockType:string}>; steps:BuildStep[]; verification:Array<{toolName:string;arguments:Record<string,unknown>;summary?:string}>; estimates:{blocksChanged:number;operations:number};warnings:string[]; }
export interface PlanValidationIssue {severity:"warning"|"error";code:string;stepId?:string;message:string;}
export function validateBuildPlan(plan:BuildPlan, limits:{maxBlocks?:number;protectedRegions?:Array<{dimension:DimensionId;region:RegionBounds}>}={}):{issues:PlanValidationIssue[];builds:GeneratedBuild[];preview?:BuildPreview}{const issues:PlanValidationIssue[]=[];const ids=new Set<string>();for(const s of plan.steps){if(ids.has(s.id))issues.push({severity:"error",code:"DUPLICATE_STEP_ID",stepId:s.id,message:"Step ids must be unique"});ids.add(s.id);}for(const s of plan.steps)for(const dep of s.dependsOn??[])if(!ids.has(dep))issues.push({severity:"error",code:"UNKNOWN_DEPENDENCY",stepId:s.id,message:`Unknown dependency ${dep}`}); const visiting=new Set<string>(),visited=new Set<string>(),byId=new Map(plan.steps.map(s=>[s.id,s]));const walk=(id:string)=>{if(visiting.has(id)){issues.push({severity:"error",code:"CIRCULAR_DEPENDENCY",stepId:id,message:"Circular dependency"});return;}if(visited.has(id))return;visiting.add(id);for(const d of byId.get(id)?.dependsOn??[])walk(d);visiting.delete(id);visited.add(id);};for(const s of plan.steps)walk(s.id);const builds:GeneratedBuild[]=[];for(const s of plan.steps)try{builds.push(generateSemantic(s.toolName,s.arguments));}catch(e){issues.push({severity:"error",code:"GEOMETRY_INVALID",stepId:s.id,message:e instanceof Error?e.message:"Geometry invalid"});}const blocks=dedupe(builds.flatMap(b=>b.blocks));if(blocks.length>(limits.maxBlocks??8192))issues.push({severity:"error",code:"VOLUME_LIMIT",message:"Generated blocks exceed configured limit"});const first=builds[0];const preview=first?previewPlacements({dimension:first.dimension,blocks,bounds:generated(first.dimension,blocks).bounds},{protectedRegions:limits.protectedRegions}):undefined;if(preview?.protectedConflicts.length)issues.push({severity:"error",code:"PROTECTED_REGION",message:"Build intersects protected regions"});return {issues,builds,preview};}
