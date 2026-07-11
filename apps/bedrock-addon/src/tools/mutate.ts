import { system, world } from "@minecraft/server";
import {
  MAX_BUILD_VOLUME,
  MAX_ROLLBACK_BLOCKS,
  regionVolume,
  type ActionRequestMessage,
  type AdminRunCommandArgs,
  type FillBlocksArgs,
  type PlaceBlocksArgs,
} from "@intelacraft/shared-protocol";

export interface MutationEvent {
  state: "running" | "completed" | "partially_completed" | "cancelled" | "failed";
  completedWork: number;
  totalEstimatedWork: number;
  message: string;
  result?: unknown;
  error?: { code: string; message: string };
}

export type AdminCommandAllowlist = Record<
  string,
  { command: string; risk?: string; label?: string }
>;

const cancelled = new Set<string>();
let emergencyDisabled = false;

export function isEmergencyDisabled() {
  return emergencyDisabled;
}

export function executeControl(action: ActionRequestMessage): MutationEvent {
  if (action.toolName === "control.cancel") {
    cancelled.add(String(action.arguments.actionId));
    return {
      state: "completed",
      completedWork: 1,
      totalEstimatedWork: 1,
      message: "Cancellation requested",
    };
  }
  emergencyDisabled = action.arguments.disabled === true;
  return {
    state: "completed",
    completedWork: 1,
    totalEstimatedWork: 1,
    message: `Emergency disable ${emergencyDisabled ? "enabled" : "cleared"}`,
  };
}

export function executeAdminCommand(
  action: ActionRequestMessage,
  allowlist: AdminCommandAllowlist,
): MutationEvent {
  if (emergencyDisabled) {
    return {
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message: "Emergency disabled",
      error: { code: "EMERGENCY_DISABLED", message: "Mutations disabled" },
    };
  }
  const args = action.arguments as unknown as AdminRunCommandArgs;
  const entry = allowlist[args.commandId];
  if (!entry) {
    return {
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message: "Command not allowlisted",
      error: { code: "UNKNOWN_COMMAND", message: `commandId '${args.commandId}' is not allowlisted` },
    };
  }
  if (args.command && args.command !== entry.command) {
    return {
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message: "Command mismatch",
      error: {
        code: "COMMAND_MISMATCH",
        message: "Resolved command does not match add-on allowlist",
      },
    };
  }
  try {
    const dimension = world.getDimension("minecraft:overworld");
    const result = dimension.runCommand(entry.command);
    return {
      state: "completed",
      completedWork: 1,
      totalEstimatedWork: 1,
      message: `Ran allowlisted command ${args.commandId}`,
      result: {
        commandId: args.commandId,
        successCount: (result as { successCount?: number }).successCount ?? 1,
      },
    };
  } catch (e) {
    return {
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message: e instanceof Error ? e.message : "Command failed",
      error: {
        code: "COMMAND_FAILED",
        message: e instanceof Error ? e.message : "Command failed",
      },
    };
  }
}

export function startFill(
  action: ActionRequestMessage,
  emit: (e: MutationEvent) => void,
  protectedRegions: Array<{
    dimension: string;
    region: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  }> = [],
): void {
  const args = action.arguments as unknown as FillBlocksArgs;
  const total = regionVolume(args.region);
  if (emergencyDisabled) {
    emit({
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: total,
      message: "Emergency disabled",
      error: { code: "EMERGENCY_DISABLED", message: "Mutations disabled" },
    });
    return;
  }
  if (total > MAX_BUILD_VOLUME) {
    emit({
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: total,
      message: "Build too large",
      error: { code: "REGION_TOO_LARGE", message: "Build exceeds independent add-on limit" },
    });
    return;
  }
  const overlaps = (
    a: FillBlocksArgs["region"],
    b: FillBlocksArgs["region"],
  ) =>
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y &&
    a.min.z <= b.max.z &&
    a.max.z >= b.min.z;
  if (
    protectedRegions.some(
      (p) => p.dimension === args.dimension && overlaps(p.region, args.region),
    )
  ) {
    emit({
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: total,
      message: "Protected region",
      error: {
        code: "PROTECTED_REGION",
        message: "Build intersects an add-on protected region",
      },
    });
    return;
  }
  const dimension = world.getDimension(args.dimension);
  let completed = 0;
  const rollback: Array<{ position: { x: number; y: number; z: number }; typeId: string }> = [];
  function* job() {
    try {
      const { min, max } = args.region;
      for (let x = min.x; x <= max.x; x++)
        for (let y = min.y; y <= max.y; y++)
          for (let z = min.z; z <= max.z; z++) {
            if (cancelled.has(action.actionId) || emergencyDisabled) {
              cancelled.delete(action.actionId);
              emit({
                state: "cancelled",
                completedWork: completed,
                totalEstimatedWork: total,
                message: `Cancelled after ${completed}/${total} blocks`,
                result: {
                  partial: true,
                  rollback: { available: rollback.length > 0, capturedBlocks: rollback.length },
                },
              });
              return;
            }
            const block = dimension.getBlock({ x, y, z });
            if (!block?.isValid) throw new Error(`Block unavailable at ${x},${y},${z}`);
            if (args.captureRollback && rollback.length < MAX_ROLLBACK_BLOCKS) {
              rollback.push({ position: { x, y, z }, typeId: block.typeId });
            }
            block.setType(args.blockType);
            completed++;
            if (completed % (args.batchSize ?? 512) === 0) {
              emit({
                state: "running",
                completedWork: completed,
                totalEstimatedWork: total,
                message: `Changed ${completed}/${total} blocks`,
              });
              yield;
            }
          }
      emit({
        state: "completed",
        completedWork: completed,
        totalEstimatedWork: total,
        message: `Changed ${completed} blocks`,
        result: {
          dimension: args.dimension,
          region: args.region,
          blockType: args.blockType,
          rollback: {
            available: rollback.length === total,
            capturedBlocks: rollback.length,
            totalBlocks: total,
            coverage: rollback.length / total,
          },
        },
      });
    } catch (e) {
      emit({
        state: completed ? "partially_completed" : "failed",
        completedWork: completed,
        totalEstimatedWork: total,
        message: e instanceof Error ? e.message : "Build failed",
        error: {
          code: "BUILD_FAILED",
          message: e instanceof Error ? e.message : "Build failed",
        },
      });
    }
  }
  system.runJob(job());
}

export function startPlaceBlocks(action: ActionRequestMessage, emit: (e: MutationEvent) => void, protectedRegions: Array<{ dimension: string; region: FillBlocksArgs["region"] }> = []): void {
  const args = action.arguments as unknown as PlaceBlocksArgs;
  const total = args.blocks.length;
  if (emergencyDisabled) { emit({ state:"failed", completedWork:0,totalEstimatedWork:total,message:"Emergency disabled",error:{code:"EMERGENCY_DISABLED",message:"Mutations disabled"} }); return; }
  const protectedHit = args.blocks.some(({ position }) => protectedRegions.some((p) => p.dimension === args.dimension && position.x >= p.region.min.x && position.x <= p.region.max.x && position.y >= p.region.min.y && position.y <= p.region.max.y && position.z >= p.region.min.z && position.z <= p.region.max.z));
  if (protectedHit) { emit({state:"failed",completedWork:0,totalEstimatedWork:total,message:"Protected region",error:{code:"PROTECTED_REGION",message:"Placement intersects an add-on protected region"}}); return; }
  const dimension = world.getDimension(args.dimension); let placed=0, skipped=0, failed=0;
  const rollback: Array<{ position: {x:number;y:number;z:number}; typeId:string }> = [];
  function* job() { try { for (const { position, blockType } of args.blocks) {
    if (cancelled.has(action.actionId) || emergencyDisabled) { cancelled.delete(action.actionId); emit({state:"cancelled",completedWork:placed,totalEstimatedWork:total,message:`Cancelled after ${placed}/${total} blocks`,result:{placed,skipped,failed,rollback:{capturedBlocks:rollback.length,coverage:rollback.length/total}}}); return; }
    const block=dimension.getBlock(position); if (!block?.isValid) { failed++; continue; }
    if (block.typeId === blockType) { skipped++; continue; }
    if(args.captureRollback && rollback.length < MAX_ROLLBACK_BLOCKS) rollback.push({position,typeId:block.typeId});
    block.setType(blockType); placed++;
    if ((placed+skipped+failed) % (args.batchSize ?? 512) === 0) { emit({state:"running",completedWork:placed,totalEstimatedWork:total,message:`Placed ${placed}/${total} blocks`,result:{placed,skipped,failed}}); yield; }
  } emit({state:failed ? "partially_completed":"completed",completedWork:placed,totalEstimatedWork:total,message:`Placed ${placed}, skipped ${skipped}, failed ${failed}`,result:{dimension:args.dimension,placed,skipped,failed,rollback:{available:rollback.length===placed,capturedBlocks:rollback.length,coverage:placed ? rollback.length/placed : 1}}}); } catch(e) { emit({state:placed?"partially_completed":"failed",completedWork:placed,totalEstimatedWork:total,message:e instanceof Error?e.message:"Placement failed",result:{placed,skipped,failed}}); } }
  system.runJob(job());
}
