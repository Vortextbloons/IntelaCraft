import { system, world } from "@minecraft/server";
import { MAX_BUILD_VOLUME, MAX_ROLLBACK_BLOCKS, regionVolume, type ActionRequestMessage, type FillBlocksArgs } from "@intelacraft/shared-protocol";

export interface MutationEvent { state:"running"|"completed"|"partially_completed"|"cancelled"|"failed"; completedWork:number; totalEstimatedWork:number; message:string; result?:unknown; error?:{code:string;message:string}; }
const cancelled=new Set<string>();
let emergencyDisabled=false;
export function isEmergencyDisabled(){return emergencyDisabled;}
export function executeControl(action:ActionRequestMessage):MutationEvent {
  if(action.toolName==="control.cancel"){cancelled.add(String(action.arguments.actionId));return {state:"completed",completedWork:1,totalEstimatedWork:1,message:"Cancellation requested"};}
  emergencyDisabled=action.arguments.disabled===true;
  return {state:"completed",completedWork:1,totalEstimatedWork:1,message:`Emergency disable ${emergencyDisabled?"enabled":"cleared"}`};
}
export function startFill(action:ActionRequestMessage, emit:(e:MutationEvent)=>void, protectedRegions:Array<{dimension:string;region:{min:{x:number;y:number;z:number};max:{x:number;y:number;z:number}}}>=[]):void {
  const args=action.arguments as unknown as FillBlocksArgs; const total=regionVolume(args.region);
  if(emergencyDisabled){emit({state:"failed",completedWork:0,totalEstimatedWork:total,message:"Emergency disabled",error:{code:"EMERGENCY_DISABLED",message:"Mutations disabled"}});return;}
  if(total>MAX_BUILD_VOLUME){emit({state:"failed",completedWork:0,totalEstimatedWork:total,message:"Build too large",error:{code:"REGION_TOO_LARGE",message:"Build exceeds independent add-on limit"}});return;}
  const overlaps=(a:FillBlocksArgs["region"],b:FillBlocksArgs["region"])=>a.min.x<=b.max.x&&a.max.x>=b.min.x&&a.min.y<=b.max.y&&a.max.y>=b.min.y&&a.min.z<=b.max.z&&a.max.z>=b.min.z;
  if(protectedRegions.some(p=>p.dimension===args.dimension&&overlaps(p.region,args.region))){emit({state:"failed",completedWork:0,totalEstimatedWork:total,message:"Protected region",error:{code:"PROTECTED_REGION",message:"Build intersects an add-on protected region"}});return;}
  const dimension=world.getDimension(args.dimension); let completed=0; const rollback:Array<{position:{x:number;y:number;z:number};typeId:string}>=[];
  function* job(){
    try {
      const {min,max}=args.region;
      for(let x=min.x;x<=max.x;x++)for(let y=min.y;y<=max.y;y++)for(let z=min.z;z<=max.z;z++){
        if(cancelled.has(action.actionId)||emergencyDisabled){cancelled.delete(action.actionId);emit({state:"cancelled",completedWork:completed,totalEstimatedWork:total,message:`Cancelled after ${completed}/${total} blocks`,result:{partial:true,rollback:{available:rollback.length>0,capturedBlocks:rollback.length}}});return;}
        const block=dimension.getBlock({x,y,z}); if(!block?.isValid) throw new Error(`Block unavailable at ${x},${y},${z}`);
        if(args.captureRollback&&rollback.length<MAX_ROLLBACK_BLOCKS)rollback.push({position:{x,y,z},typeId:block.typeId});
        block.setType(args.blockType); completed++;
        if(completed%(args.batchSize??512)===0){emit({state:"running",completedWork:completed,totalEstimatedWork:total,message:`Changed ${completed}/${total} blocks`});yield;}
      }
      emit({state:"completed",completedWork:completed,totalEstimatedWork:total,message:`Changed ${completed} blocks`,result:{dimension:args.dimension,region:args.region,blockType:args.blockType,rollback:{available:rollback.length===total,capturedBlocks:rollback.length,totalBlocks:total,coverage:rollback.length/total}}});
    }catch(e){emit({state:completed?"partially_completed":"failed",completedWork:completed,totalEstimatedWork:total,message:e instanceof Error?e.message:"Build failed",error:{code:"BUILD_FAILED",message:e instanceof Error?e.message:"Build failed"}});}
  }
  system.runJob(job());
}
