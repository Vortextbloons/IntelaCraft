import { EquipmentSlot, PlayerPermissionLevel, world } from "@minecraft/server";
import {
  MAX_REGION_VOLUME,
  regionVolume,
  type ActionRequestMessage,
  type DimensionId,
  type InspectBlockArgs,
  type InspectEntitiesArgs,
  type InspectPlayerArgs,
  type InspectPlayersArgs,
  type InspectRegionArgs,
  type InspectScoreboardArgs,
  type InspectServerStatusArgs,
  type InspectTagsArgs,
  type InspectWorldStateArgs,
  type ReadToolName,
  type InspectHeightmapArgs, type InspectSurfaceArgs, type InspectBuildCollisionArgs, type InspectFindEmptyAreaArgs,
} from "@intelacraft/shared-protocol";

export interface ToolSuccess {
  ok: true;
  result: unknown;
  completedWork: number;
  totalEstimatedWork: number;
  message: string;
}

export interface ToolFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

export type ToolResult = ToolSuccess | ToolFailure;

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

function getDimension(id: DimensionId) {
  return world.getDimension(id);
}

export function executeInspectTool(action: ActionRequestMessage): ToolResult {
  const toolName = action.toolName as ReadToolName;
  try {
    switch (toolName) {
      case "inspect.server_status":
        return inspectServerStatus(action.arguments as unknown as InspectServerStatusArgs);
      case "inspect.players":
        return inspectPlayers(action.arguments as unknown as InspectPlayersArgs);
      case "inspect.player":
        return inspectPlayer(action.arguments as unknown as InspectPlayerArgs);
      case "inspect.block":
        return inspectBlock(action.arguments as unknown as InspectBlockArgs);
      case "inspect.region":
        return inspectRegion(action.arguments as unknown as InspectRegionArgs);
      case "inspect.world_state":
        return inspectWorldState(action.arguments as unknown as InspectWorldStateArgs);
      case "inspect.entities":
        return inspectEntities(action.arguments as unknown as InspectEntitiesArgs);
      case "inspect.scoreboard":
        return inspectScoreboard(action.arguments as unknown as InspectScoreboardArgs);
      case "inspect.tags":
        return inspectTags(action.arguments as unknown as InspectTagsArgs);
      case "inspect.heightmap": return inspectHeightmap(action.arguments as unknown as InspectHeightmapArgs, false);
      case "inspect.surface": return inspectHeightmap(action.arguments as unknown as InspectSurfaceArgs, true);
      case "inspect.build_collision": return inspectBuildCollision(action.arguments as unknown as InspectBuildCollisionArgs);
      case "inspect.find_empty_area": return inspectFindEmptyArea(action.arguments as unknown as InspectFindEmptyAreaArgs);
      default:
        return {
          ok: false,
          code: "UNKNOWN_TOOL",
          message: `Unsupported tool '${action.toolName}'`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    return { ok: false, code: "TOOL_ERROR", message };
  }
}

function surfaceAt(dimension: ReturnType<typeof getDimension>, x:number, z:number, fromY:number, toY:number) { for(let y=toY;y>=fromY;y--){ const block=dimension.getBlock({x,y,z}); if(block?.isValid&&!block.isAir&&!block.isLiquid) return {y,typeId:block.typeId}; } return null; }
function inspectHeightmap(args: InspectHeightmapArgs, includeSurface:boolean): ToolResult { const d=getDimension(args.dimension), samples:Array<Record<string,unknown>>=[]; const r=args.region, resolution=args.resolution??1; for(let x=r.min.x;x<=r.max.x;x+=resolution) for(let z=r.min.z;z<=r.max.z;z+=resolution) { const top=surfaceAt(d,x,z,r.min.y,r.max.y); samples.push({x,z,height:top?.y??null,...(includeSurface?{surfaceType:top?.typeId??"minecraft:air"}:{})}); } const heights=samples.map(s=>s.height).filter((h):h is number=>typeof h==='number'); const min=heights.length?Math.min(...heights):null,max=heights.length?Math.max(...heights):null,average=heights.length?heights.reduce((a,b)=>a+b,0)/heights.length:null; return {ok:true,result:{dimension:args.dimension,region:r,resolution,min,max,average,slope:min===null||max===null?null:max-min,columns:samples},completedWork:samples.length,totalEstimatedWork:samples.length,message:`Sampled ${samples.length} terrain columns`}; }
function inspectBuildCollision(args: InspectBuildCollisionArgs): ToolResult { const d=getDimension(args.dimension), collisions:Array<Record<string,unknown>>=[]; let checked=0; for(let x=args.region.min.x;x<=args.region.max.x;x++)for(let y=args.region.min.y;y<=args.region.max.y;y++)for(let z=args.region.min.z;z<=args.region.max.z;z++){checked++;const b=d.getBlock({x,y,z});if(b?.isValid&&!b.isAir)collisions.push({position:{x,y,z},type:"block",blockType:b.typeId});} const entities=d.getEntities().filter(e=>{const p=e.location;return p.x>=args.region.min.x&&p.x<=args.region.max.x+1&&p.y>=args.region.min.y&&p.y<=args.region.max.y+1&&p.z>=args.region.min.z&&p.z<=args.region.max.z+1}).map(e=>({type:"entity",id:e.id,typeId:e.typeId})); return {ok:true,result:{dimension:args.dimension,region:args.region,nonAirBlocks:collisions.length,collisions:[...collisions,...entities],worldHeightValid:args.region.min.y>=-64&&args.region.max.y<=319},completedWork:checked,totalEstimatedWork:checked,message:`Found ${collisions.length+entities.length} collision(s)`}; }
function inspectFindEmptyArea(args: InspectFindEmptyAreaArgs): ToolResult { const candidates:Array<Record<string,unknown>>=[]; const d=getDimension(args.dimension),step=Math.max(1,Math.ceil(args.requiredSize.x/2)); for(let dx=-args.radius;dx<=args.radius;dx+=step)for(let dz=-args.radius;dz<=args.radius;dz+=step){const min={x:args.origin.x+dx,y:args.origin.y,z:args.origin.z+dz},max={x:min.x+args.requiredSize.x-1,y:min.y+args.requiredSize.y-1,z:min.z+args.requiredSize.z-1};const c=inspectBuildCollision({dimension:args.dimension,region:{min,max}});if(c.ok){const data=c.result as {nonAirBlocks:number};const heights=[surfaceAt(d,min.x,min.z,-64,319),surfaceAt(d,max.x,min.z,-64,319),surfaceAt(d,min.x,max.z,-64,319),surfaceAt(d,max.x,max.z,-64,319)].map(s=>s?.y).filter((y):y is number=>typeof y==="number");const slope=heights.length?Math.max(...heights)-Math.min(...heights):999; if(args.maxSlope!==undefined&&slope>args.maxSlope)continue; const suitable=heights.length===4; candidates.push({region:{min,max},obstructions:data.nonAirBlocks,distance:Math.abs(dx)+Math.abs(dz),slope,surfaceSuitable:suitable,score:data.nonAirBlocks*1000+slope*20+Math.abs(dx)+Math.abs(dz)+(suitable?0:500)});}} candidates.sort((a,b)=>Number(a.score)-Number(b.score)); return {ok:true,result:{dimension:args.dimension,requiredSize:args.requiredSize,maxSlope:args.maxSlope??null,candidates:candidates.slice(0,8)},completedWork:candidates.length,totalEstimatedWork:candidates.length,message:`Ranked ${candidates.length} terrain-suitable candidate areas`}; }

function inspectServerStatus(args: InspectServerStatusArgs): ToolResult {
  const players = world.getPlayers();
  const result: Record<string, unknown> = {
    playerCount: players.length,
    players: players.map((p) => p.name),
  };
  if (args.includeDimensions) {
    result.dimensions = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
  }
  return {
    ok: true,
    result,
    completedWork: 1,
    totalEstimatedWork: 1,
    message: "Server status collected",
  };
}

function inspectPlayers(args: InspectPlayersArgs): ToolResult {
  const filter = args.nameFilter?.toLowerCase();
  const players = world.getPlayers().filter((p) => {
    if (!filter) return true;
    return p.name.toLowerCase().includes(filter);
  });
  return {
    ok: true,
    result: {
      count: players.length,
      players: players.map((p) => {
        const loc = p.location;
        return {
          name: p.name,
          id: p.id,
          dimension: p.dimension.id,
          location: {
            x: Math.floor(loc.x),
            y: Math.floor(loc.y),
            z: Math.floor(loc.z),
          },
          permissionLevel: p.playerPermissionLevel,
          isOperator: p.playerPermissionLevel === PlayerPermissionLevel.Operator,
        };
      }),
    },
    completedWork: players.length,
    totalEstimatedWork: players.length,
    message: `Found ${players.length} player(s)`,
  };
}

function inspectPlayer(args: InspectPlayerArgs): ToolResult {
  const player = world.getPlayers().find((candidate) => candidate.name === args.name);
  if (!player) {
    return {
      ok: false,
      code: "PLAYER_NOT_FOUND",
      message: `No online player matched '${args.name}'`,
    };
  }

  const health = player.getComponent("minecraft:health");
  // Absorption is not typed by every supported Script API release. Keep it
  // nullable so a missing runtime component is not misreported as zero.
  const absorption = player.getComponent("minecraft:absorption") as
    | { currentValue?: number }
    | undefined;
  const inventoryComponent = player.getComponent("minecraft:inventory");
  const equippable = player.getComponent("minecraft:equippable");
  const inventory = [];
  const container = inventoryComponent?.container;
  if (container?.isValid) {
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item) inventory.push({ slot, typeId: item.typeId, amount: item.amount });
    }
  }
  const itemDetails = (slot: EquipmentSlot) => {
    const item = equippable?.getEquipment(slot);
    return item ? { typeId: item.typeId, amount: item.amount } : null;
  };
  const location = player.location;
  const effects = player.getEffects().map((effect) => ({
    id: effect.typeId,
    amplifier: effect.amplifier,
    duration: effect.duration,
  }));

  return {
    ok: true,
    result: {
      name: player.name,
      id: player.id,
      alive: player.isValid,
      dimension: player.dimension.id,
      location: {
        x: Math.floor(location.x),
        y: Math.floor(location.y),
        z: Math.floor(location.z),
      },
      gameMode: player.getGameMode(),
      health: health
        ? { current: health.currentValue, max: health.effectiveMax }
        : null,
      absorption: absorption?.currentValue ?? null,
      xp: {
        level: player.level,
        total: player.getTotalXp(),
        atCurrentLevel: player.xpEarnedAtCurrentLevel,
      },
      effects,
      inventory,
      armor: {
        head: itemDetails(EquipmentSlot.Head),
        chest: itemDetails(EquipmentSlot.Chest),
        legs: itemDetails(EquipmentSlot.Legs),
        feet: itemDetails(EquipmentSlot.Feet),
      },
      isOperator: player.playerPermissionLevel === PlayerPermissionLevel.Operator,
      tags: player.getTags(),
    },
    completedWork: 1,
    totalEstimatedWork: 1,
    message: `Detailed info collected for ${player.name}`,
  };
}

function inspectBlock(args: InspectBlockArgs): ToolResult {
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

function inspectRegion(args: InspectRegionArgs): ToolResult {
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

function inspectWorldState(args: InspectWorldStateArgs): ToolResult {
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

function inspectEntities(args: InspectEntitiesArgs): ToolResult {
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

function inspectScoreboard(args: InspectScoreboardArgs): ToolResult {
  const scoreboard = world.scoreboard;
  const objectives = scoreboard.getObjectives();
  const selected = args.objective
    ? objectives.filter((o) => o.id === args.objective)
    : objectives;
  if (args.objective && selected.length === 0) {
    return {
      ok: false,
      code: "OBJECTIVE_NOT_FOUND",
      message: `Objective '${args.objective}' not found`,
    };
  }
  const result = selected.map((obj) => {
    const participants = obj.getParticipants();
    const scores = participants.slice(0, 64).map((p) => ({
      displayName: p.displayName,
      score: obj.getScore(p) ?? null,
    }));
    return {
      id: obj.id,
      displayName: obj.displayName,
      participantCount: participants.length,
      scores,
    };
  });
  return {
    ok: true,
    result: { objectives: result },
    completedWork: result.length,
    totalEstimatedWork: result.length,
    message: `Read ${result.length} objective(s)`,
  };
}

function inspectTags(args: InspectTagsArgs): ToolResult {
  if (args.player !== false) {
    const player = world
      .getPlayers()
      .find((p) => p.name === args.target || p.id === args.target);
    if (player) {
      const tags = player.getTags();
      return {
        ok: true,
        result: { kind: "player", name: player.name, id: player.id, tags },
        completedWork: tags.length,
        totalEstimatedWork: tags.length,
        message: `Player ${player.name} has ${tags.length} tag(s)`,
      };
    }
  }
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"] as const) {
    const entities = world.getDimension(dimId).getEntities();
    const entity = entities.find((e) => e.id === args.target || e.nameTag === args.target);
    if (entity) {
      const tags = entity.getTags();
      return {
        ok: true,
        result: {
          kind: "entity",
          id: entity.id,
          typeId: entity.typeId,
          nameTag: entity.nameTag || undefined,
          tags,
        },
        completedWork: tags.length,
        totalEstimatedWork: tags.length,
        message: `Entity ${entity.typeId} has ${tags.length} tag(s)`,
      };
    }
  }
  return {
    ok: false,
    code: "TARGET_NOT_FOUND",
    message: `No player or entity matched '${args.target}'`,
  };
}
