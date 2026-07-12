import { world } from "@minecraft/server";
import {
  MAX_REGION_VOLUME,
  regionVolume,
  type InspectBlockArgs,
  type InspectEntitiesArgs,
  type InspectRegionArgs,
  type InspectWorldStateArgs,
  type InspectVoxelSnapshotArgs,
} from "@intelacraft/shared-protocol";
import { getDimension, type ToolResult } from "./helpers.js";

const DEFAULT_GAME_RULE_KEYS = [
  "doDayLightCycle",
  "doMobSpawning",
  "doWeatherCycle",
  "keepInventory",
  "mobGriefing",
  "pvp",
  "showCoordinates",
  "tntExplodes",
] as const;

export function inspectBlock(args: InspectBlockArgs): ToolResult {
  const dimension = getDimension(args.dimension);
  const block = dimension.getBlock(args.position);
  if (!block || !block.isValid) {
    return {
      ok: false,
      code: "BLOCK_UNAVAILABLE",
      message: "Block is unloaded or out of world",
      details: { dimension: args.dimension, position: args.position },
    };
  }
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      position: { x: block.x, y: block.y, z: block.z },
      typeId: block.typeId,
      isAir: block.isAir,
      isLiquid: block.isLiquid,
      isWaterlogged: block.isWaterlogged,
    },
    completedWork: 1,
    totalEstimatedWork: 1,
    message: `Block ${block.typeId}`,
  };
}

export function inspectRegion(args: InspectRegionArgs): ToolResult {
  const volume = regionVolume(args.region);
  if (volume > MAX_REGION_VOLUME) {
    return {
      ok: false,
      code: "REGION_TOO_LARGE",
      message: `Region volume ${volume} exceeds max ${MAX_REGION_VOLUME}`,
      details: { volume, max: MAX_REGION_VOLUME, region: args.region },
    };
  }
  const dimension = getDimension(args.dimension);
  const counts: Record<string, number> = {};
  let read = 0;
  let unloaded = 0;
  const { min, max } = args.region;
  for (let x = min.x; x <= max.x; x++) {
    for (let y = min.y; y <= max.y; y++) {
      for (let z = min.z; z <= max.z; z++) {
        const block = dimension.getBlock({ x, y, z });
        if (!block || !block.isValid) {
          unloaded += 1;
          continue;
        }
        read += 1;
        counts[block.typeId] = (counts[block.typeId] ?? 0) + 1;
      }
    }
  }
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      region: args.region,
      volume,
      blocksRead: read,
      unloaded,
      typeCounts: counts,
    },
    completedWork: read,
    totalEstimatedWork: volume,
    message: `Inspected ${read}/${volume} blocks`,
  };
}

export function inspectVoxelSnapshot(args:InspectVoxelSnapshotArgs):ToolResult {
 const volume=regionVolume(args.region);if(volume>MAX_REGION_VOLUME)return {ok:false,code:"REGION_TOO_LARGE",message:`Region volume ${volume} exceeds max ${MAX_REGION_VOLUME}`};const dimension=getDimension(args.dimension),palette:Array<{typeId:string;states?:Record<string,string|number|boolean>}>=[],indexes=new Map<string,number>(),blocks:number[]=[];const {min,max}=args.region;
 for(let y=min.y;y<=max.y;y++)for(let z=min.z;z<=max.z;z++)for(let x=min.x;x<=max.x;x++){const block=dimension.getBlock({x,y,z});if(!block||!block.isValid)return {ok:false,code:"SNAPSHOT_INCOMPLETE",message:"Snapshot includes an unloaded or unavailable block",details:{position:{x,y,z}}};const states=block.permutation.getAllStates(),identity=JSON.stringify([block.typeId,Object.entries(states).sort(([a],[b])=>a.localeCompare(b))]);let index=indexes.get(identity);if(index===undefined){index=palette.length;indexes.set(identity,index);palette.push(Object.keys(states).length?{typeId:block.typeId,states}:{typeId:block.typeId});}blocks.push(index);}
 return {ok:true,result:{version:1,dimension:args.dimension,bounds:args.region,palette,blocks,indexType:palette.length<=65536?"uint16":"uint32",capturedAt:new Date().toISOString()},completedWork:volume,totalEstimatedWork:volume,message:`Captured ${volume} voxels`};
}

export function inspectWorldState(args: InspectWorldStateArgs): ToolResult {
  const dimensionId = args.dimension ?? "minecraft:overworld";
  const dimension = getDimension(dimensionId);
  const rules = world.gameRules;
  const ruleNames =
    args.rules && args.rules.length > 0 ? args.rules : [...DEFAULT_GAME_RULE_KEYS];
  const ruleValues: Record<string, unknown> = {};
  const ruleBag = rules as unknown as Record<string, unknown>;
  for (const name of ruleNames) {
    ruleValues[name] = ruleBag[name] ?? null;
  }
  return {
    ok: true,
    result: {
      time: {
        dimension: dimensionId,
        timeOfDay: world.getTimeOfDay(),
        absoluteTime: world.getAbsoluteTime(),
        day: world.getDay(),
      },
      weather: {
        dimension: dimensionId,
        weather: dimension.getWeather(),
      },
      rules: ruleValues,
    },
    completedWork: ruleNames.length,
    totalEstimatedWork: ruleNames.length,
    message: `World state: time, weather, ${ruleNames.length} rule(s)`,
  };
}

export function inspectEntities(args: InspectEntitiesArgs): ToolResult {
  const dimension = getDimension(args.dimension);
  const filter = args.typeFilter?.toLowerCase();
  const limit = args.limit ?? 64;
  const entities = dimension.getEntities();
  const matched = [];
  for (const entity of entities) {
    if (filter && !entity.typeId.toLowerCase().includes(filter)) continue;
    const loc = entity.location;
    matched.push({
      id: entity.id,
      typeId: entity.typeId,
      nameTag: entity.nameTag || undefined,
      location: {
        x: Math.floor(loc.x),
        y: Math.floor(loc.y),
        z: Math.floor(loc.z),
      },
    });
    if (matched.length >= limit) break;
  }
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      count: matched.length,
      truncated: entities.length > matched.length,
      entities: matched,
    },
    completedWork: matched.length,
    totalEstimatedWork: matched.length,
    message: `Found ${matched.length} entit${matched.length === 1 ? "y" : "ies"}`,
  };
}
