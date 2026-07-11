import { EquipmentSlot, PlayerPermissionLevel, world } from "@minecraft/server";
import type {
  InspectPlayerArgs,
  InspectPlayersArgs,
  InspectServerStatusArgs,
} from "@intelacraft/shared-protocol";
import type { ToolResult } from "./helpers.js";

export function inspectServerStatus(args: InspectServerStatusArgs): ToolResult {
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

export function inspectPlayers(args: InspectPlayersArgs): ToolResult {
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

export function inspectPlayer(args: InspectPlayerArgs): ToolResult {
  const player = world.getPlayers().find((candidate) => candidate.name === args.name);
  if (!player) {
    return {
      ok: false,
      code: "PLAYER_NOT_FOUND",
      message: `No online player matched '${args.name}'`,
    };
  }

  const health = player.getComponent("minecraft:health");
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
      health: health ? { current: health.currentValue, max: health.effectiveMax } : null,
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
