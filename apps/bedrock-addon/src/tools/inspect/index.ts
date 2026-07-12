import type {
  ActionRequestMessage,
  InspectBlockArgs,
  InspectBuildCollisionArgs,
  InspectEntitiesArgs,
  InspectFindEmptyAreaArgs,
  InspectHeightmapArgs,
  InspectPlayerArgs,
  InspectPlayersArgs,
  InspectRegionArgs,
  InspectScoreboardArgs,
  InspectServerStatusArgs,
  InspectSurfaceArgs,
  InspectTagsArgs,
  InspectWorldStateArgs,
  InspectVoxelSnapshotArgs,
  ReadToolName,
} from "@intelacraft/shared-protocol";
import { inspectScoreboard, inspectTags } from "./meta.js";
import { inspectPlayer, inspectPlayers, inspectServerStatus } from "./server.js";
import {
  inspectBuildCollision,
  inspectFindEmptyArea,
  inspectHeightmap,
  inspectSurface,
} from "./terrain.js";
import type { ToolResult } from "./helpers.js";
import { inspectBlock, inspectEntities, inspectRegion, inspectVoxelSnapshot, inspectWorldState } from "./world.js";

export type { ToolResult, ToolSuccess, ToolFailure } from "./helpers.js";

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
      case "inspect.voxel_snapshot":
        return inspectVoxelSnapshot(action.arguments as unknown as InspectVoxelSnapshotArgs);
      case "inspect.world_state":
        return inspectWorldState(action.arguments as unknown as InspectWorldStateArgs);
      case "inspect.entities":
        return inspectEntities(action.arguments as unknown as InspectEntitiesArgs);
      case "inspect.scoreboard":
        return inspectScoreboard(action.arguments as unknown as InspectScoreboardArgs);
      case "inspect.tags":
        return inspectTags(action.arguments as unknown as InspectTagsArgs);
      case "inspect.heightmap":
        return inspectHeightmap(action.arguments as unknown as InspectHeightmapArgs, false);
      case "inspect.surface":
        return inspectSurface(action.arguments as unknown as InspectSurfaceArgs);
      case "inspect.build_collision":
        return inspectBuildCollision(action.arguments as unknown as InspectBuildCollisionArgs);
      case "inspect.find_empty_area":
        return inspectFindEmptyArea(action.arguments as unknown as InspectFindEmptyAreaArgs);
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
