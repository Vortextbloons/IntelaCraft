import { world } from "@minecraft/server";
import type { InspectScoreboardArgs, InspectTagsArgs } from "@intelacraft/shared-protocol";
import type { ToolResult } from "./helpers.js";

export function inspectScoreboard(args: InspectScoreboardArgs): ToolResult {
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

export function inspectTags(args: InspectTagsArgs): ToolResult {
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
