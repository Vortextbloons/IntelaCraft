import { isNonEmptyString, parseRegion, parseVec3i } from "../helpers.js";
import type {
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
} from "../types.js";
import { MAX_REGION_VOLUME } from "../constants.js";
import { regionVolume } from "../helpers.js";
import { fail, isDimensionId, ok, type ValidateResult } from "./common.js";

export function validateHeightmap(
  args: Record<string, unknown>,
): ValidateResult<InspectHeightmapArgs | InspectSurfaceArgs> {
  if (!isDimensionId(args.dimension)) return fail("INVALID_ARGS", "dimension is required");
  const region = parseRegion(args.region);
  if (!region) return fail("INVALID_ARGS", "region must include min/max integer corners");
  const resolution = args.resolution ?? 1;
  if (resolution !== 1 && resolution !== 2 && resolution !== 4) {
    return fail("INVALID_ARGS", "resolution must be 1, 2, or 4");
  }
  return ok({ dimension: args.dimension, region, resolution });
}

export function validateBuildCollision(
  args: Record<string, unknown>,
): ValidateResult<InspectBuildCollisionArgs> {
  if (!isDimensionId(args.dimension)) return fail("INVALID_ARGS", "dimension is required");
  const region = parseRegion(args.region);
  if (!region) return fail("INVALID_ARGS", "region must include min/max integer corners");
  return ok({ dimension: args.dimension, region });
}

export function validateFindEmptyArea(
  args: Record<string, unknown>,
): ValidateResult<InspectFindEmptyAreaArgs> {
  if (!isDimensionId(args.dimension)) return fail("INVALID_ARGS", "dimension is required");
  const origin = parseVec3i(args.origin);
  const requiredSize = parseVec3i(args.requiredSize);
  if (!origin || !requiredSize || requiredSize.x < 1 || requiredSize.y < 1 || requiredSize.z < 1) {
    return fail("INVALID_ARGS", "origin and positive requiredSize are required");
  }
  if (!Number.isInteger(args.radius) || (args.radius as number) < 0 || (args.radius as number) > 128) {
    return fail("INVALID_ARGS", "radius must be an integer 0-128");
  }
  if (args.maxSlope !== undefined && (!Number.isFinite(args.maxSlope) || Number(args.maxSlope) < 0)) {
    return fail("INVALID_ARGS", "maxSlope must be non-negative");
  }
  return ok({
    dimension: args.dimension,
    origin,
    requiredSize,
    radius: args.radius as number,
    maxSlope: typeof args.maxSlope === "number" ? args.maxSlope : undefined,
  });
}

export function validateInspectServerStatus(
  args: Record<string, unknown>,
): ValidateResult<InspectServerStatusArgs> {
  const includeDimensions =
    args.includeDimensions === undefined ? undefined : Boolean(args.includeDimensions);
  return ok({ includeDimensions });
}

export function validateInspectPlayers(
  args: Record<string, unknown>,
): ValidateResult<InspectPlayersArgs> {
  if (args.nameFilter !== undefined && typeof args.nameFilter !== "string") {
    return fail("INVALID_ARGS", "nameFilter must be a string");
  }
  return ok({
    nameFilter: typeof args.nameFilter === "string" ? args.nameFilter : undefined,
  });
}

export function validateInspectPlayer(
  args: Record<string, unknown>,
): ValidateResult<InspectPlayerArgs> {
  if (!isNonEmptyString(args.name)) {
    return fail("INVALID_ARGS", "name is required");
  }
  return ok({ name: args.name });
}

export function validateInspectBlock(args: Record<string, unknown>): ValidateResult<InspectBlockArgs> {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  const position = parseVec3i(args.position);
  if (!position) return fail("INVALID_ARGS", "position must be integer x,y,z");
  return ok({ dimension: args.dimension, position });
}

export function validateInspectRegion(args: Record<string, unknown>): ValidateResult<InspectRegionArgs> {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  const region = parseRegion(args.region);
  if (!region) return fail("INVALID_ARGS", "region must include min/max integer corners");
  return ok({
    dimension: args.dimension,
    region,
    countsOnly: args.countsOnly === undefined ? true : Boolean(args.countsOnly),
  });
}

export function validateInspectVoxelSnapshot(args:Record<string,unknown>):ValidateResult<InspectVoxelSnapshotArgs>{
 if(!isDimensionId(args.dimension))return fail("INVALID_ARGS","dimension is required");const region=parseRegion(args.region);if(!region)return fail("INVALID_ARGS","region must include min/max integer corners");const volume=regionVolume(region);if(volume>MAX_REGION_VOLUME)return fail("REGION_TOO_LARGE",`Region volume ${volume} exceeds max ${MAX_REGION_VOLUME}`);return ok({dimension:args.dimension,region});
}

export function validateInspectWorldState(
  args: Record<string, unknown>,
): ValidateResult<InspectWorldStateArgs> {
  if (args.dimension !== undefined && !isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is invalid");
  }
  if (args.rules !== undefined) {
    if (!Array.isArray(args.rules) || !args.rules.every((n) => typeof n === "string")) {
      return fail("INVALID_ARGS", "rules must be a string array");
    }
    return ok({
      dimension: isDimensionId(args.dimension) ? args.dimension : undefined,
      rules: args.rules as string[],
    });
  }
  return ok({
    dimension: isDimensionId(args.dimension) ? args.dimension : undefined,
  });
}

export function validateInspectEntities(
  args: Record<string, unknown>,
): ValidateResult<InspectEntitiesArgs> {
  if (!isDimensionId(args.dimension)) {
    return fail("INVALID_ARGS", "dimension is required");
  }
  if (args.typeFilter !== undefined && typeof args.typeFilter !== "string") {
    return fail("INVALID_ARGS", "typeFilter must be a string");
  }
  const limit = args.limit === undefined ? 64 : args.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 128) {
    return fail("INVALID_ARGS", "limit must be an integer 1-128");
  }
  return ok({
    dimension: args.dimension,
    typeFilter: typeof args.typeFilter === "string" ? args.typeFilter : undefined,
    limit: limit as number,
  });
}

export function validateInspectScoreboard(
  args: Record<string, unknown>,
): ValidateResult<InspectScoreboardArgs> {
  if (args.objective !== undefined && typeof args.objective !== "string") {
    return fail("INVALID_ARGS", "objective must be a string");
  }
  return ok({
    objective: typeof args.objective === "string" ? args.objective : undefined,
  });
}

export function validateInspectTags(args: Record<string, unknown>): ValidateResult<InspectTagsArgs> {
  if (!isNonEmptyString(args.target)) {
    return fail("INVALID_ARGS", "target is required");
  }
  return ok({
    target: args.target,
    player: args.player === undefined ? true : Boolean(args.player),
  });
}
