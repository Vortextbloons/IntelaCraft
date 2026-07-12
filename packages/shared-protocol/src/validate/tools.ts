import type { ToolName } from "../constants.js";
import { isNonEmptyString } from "../helpers.js";
import { asArgs, fail, ok, type ValidateResult } from "./common.js";
import {
  validateBuildCollision,
  validateFindEmptyArea,
  validateHeightmap,
  validateInspectBlock,
  validateInspectEntities,
  validateInspectPlayer,
  validateInspectPlayers,
  validateInspectRegion,
  validateInspectVoxelSnapshot,
  validateInspectScoreboard,
  validateInspectServerStatus,
  validateInspectTags,
  validateInspectWorldState,
} from "./tools-inspect.js";
import {
  validateAdminRunCommand,
  validateFillBlocks,
  validatePlaceBlocks,
} from "./tools-mutate.js";

export function validateToolArguments(
  toolName: ToolName,
  args: Record<string, unknown>,
): ValidateResult<Record<string, unknown>> {
  switch (toolName) {
    case "inspect.server_status":
      return asArgs(validateInspectServerStatus(args));
    case "inspect.players":
      return asArgs(validateInspectPlayers(args));
    case "inspect.player":
      return asArgs(validateInspectPlayer(args));
    case "inspect.block":
      return asArgs(validateInspectBlock(args));
    case "inspect.region":
      return asArgs(validateInspectRegion(args));
    case "inspect.voxel_snapshot":
      return asArgs(validateInspectVoxelSnapshot(args));
    case "inspect.world_state":
      return asArgs(validateInspectWorldState(args));
    case "inspect.entities":
      return asArgs(validateInspectEntities(args));
    case "inspect.scoreboard":
      return asArgs(validateInspectScoreboard(args));
    case "inspect.tags":
      return asArgs(validateInspectTags(args));
    case "inspect.heightmap":
      return asArgs(validateHeightmap(args));
    case "inspect.surface":
      return asArgs(validateHeightmap(args));
    case "inspect.build_collision":
      return asArgs(validateBuildCollision(args));
    case "inspect.find_empty_area":
      return asArgs(validateFindEmptyArea(args));
    case "world.fill_blocks":
      return asArgs(validateFillBlocks(args));
    case "world.place_blocks":
      return asArgs(validatePlaceBlocks(args));
    case "control.cancel":
      if (!isNonEmptyString(args.actionId)) return fail("INVALID_ARGS", "actionId is required");
      return ok({ actionId: args.actionId });
    case "control.emergency_disable":
      if (typeof args.disabled !== "boolean") return fail("INVALID_ARGS", "disabled must be boolean");
      return ok({ disabled: args.disabled });
    case "admin.run_command":
      return asArgs(validateAdminRunCommand(args));
    default:
      return fail("UNKNOWN_TOOL", `Unknown tool '${toolName}'`);
  }
}
