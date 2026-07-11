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
