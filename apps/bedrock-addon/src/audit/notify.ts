import { PlayerPermissionLevel, world } from "@minecraft/server";

/** Optional in-game status without secrets. */
export function notifyOperators(message: string): void {
  try {
    for (const player of world.getPlayers()) {
      if (player.playerPermissionLevel === PlayerPermissionLevel.Operator) {
        player.sendMessage(`§7[IntelaCraft]§r ${message}`);
      }
    }
  } catch {
    // Ignore notification failures.
  }
  console.warn(`[IntelaCraft] ${message}`);
}
