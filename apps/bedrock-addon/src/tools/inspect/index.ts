import { PlayerPermissionLevel, world } from "@minecraft/server";
import {
  MAX_REGION_VOLUME,
  regionVolume,
  type ActionRequestMessage,
  type DimensionId,
  type InspectBlockArgs,
  type InspectGameRulesArgs,
  type InspectPlayersArgs,
  type InspectRegionArgs,
  type InspectServerStatusArgs,
  type InspectTimeArgs,
  type InspectWeatherArgs,
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
      case "inspect.block":
        return inspectBlock(action.arguments as unknown as InspectBlockArgs);
      case "inspect.region":
        return inspectRegion(action.arguments as unknown as InspectRegionArgs);
      case "inspect.time":
        return inspectTime(action.arguments as unknown as InspectTimeArgs);
      case "inspect.weather":
        return inspectWeather(action.arguments as unknown as InspectWeatherArgs);
      case "inspect.game_rules":
        return inspectGameRules(action.arguments as unknown as InspectGameRulesArgs);
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
    result.dimensions = [
      "minecraft:overworld",
      "minecraft:nether",
      "minecraft:the_end",
    ];
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

function inspectTime(args: InspectTimeArgs): ToolResult {
  const dimensionId = args.dimension ?? "minecraft:overworld";
  return {
    ok: true,
    result: {
      dimension: dimensionId,
      timeOfDay: world.getTimeOfDay(),
      absoluteTime: world.getAbsoluteTime(),
      day: world.getDay(),
    },
    completedWork: 1,
    totalEstimatedWork: 1,
    message: "Time inspected",
  };
}

function inspectWeather(args: InspectWeatherArgs): ToolResult {
  const dimensionId = args.dimension ?? "minecraft:overworld";
  const dimension = getDimension(dimensionId);
  return {
    ok: true,
    result: {
      dimension: dimensionId,
      weather: dimension.getWeather(),
    },
    completedWork: 1,
    totalEstimatedWork: 1,
    message: "Weather inspected",
  };
}

function inspectGameRules(args: InspectGameRulesArgs): ToolResult {
  const rules = world.gameRules;
  const names =
    args.names && args.names.length > 0 ? args.names : [...DEFAULT_GAME_RULE_KEYS];
  const values: Record<string, unknown> = {};
  const ruleBag = rules as unknown as Record<string, unknown>;
  for (const name of names) {
    values[name] = ruleBag[name] ?? null;
  }
  return {
    ok: true,
    result: { rules: values },
    completedWork: names.length,
    totalEstimatedWork: names.length,
    message: `Read ${names.length} game rule(s)`,
  };
}
