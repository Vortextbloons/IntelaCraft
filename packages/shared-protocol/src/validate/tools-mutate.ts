import {
  DEFAULT_BATCH_SIZE,
  MAX_BUILD_VOLUME,
  MAX_PLACE_BLOCKS,
} from "../constants.js";
import { isNonEmptyString, parseRegion, parseVec3i } from "../helpers.js";
import type { AdminRunCommandArgs, FillBlocksArgs, PlaceBlocksArgs } from "../types.js";
import { fail, isDimensionId, ok, type ValidateResult } from "./common.js";

function parseBlockStates(value: unknown): PlaceBlocksArgs["blocks"][number]["states"] | null | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 16) return null;
  const states: NonNullable<PlaceBlocksArgs["blocks"][number]["states"]> = {};
  for (const [name, state] of entries) {
    if (!/^[a-z0-9_.:-]{1,64}$/.test(name) || ["__proto__","constructor","prototype"].includes(name) || !["string", "number", "boolean"].includes(typeof state)) return null;
    if (typeof state === "number" && !Number.isFinite(state)) return null;
    if (typeof state === "string" && state.length > 128) return null;
    states[name] = state as string | number | boolean;
  }
  return states;
}

export function validatePlaceBlocks(args: Record<string, unknown>): ValidateResult<PlaceBlocksArgs> {
  if (!isDimensionId(args.dimension)) return fail("INVALID_ARGS", "dimension is required");
  if (!Array.isArray(args.blocks) || args.blocks.length < 1 || args.blocks.length > MAX_PLACE_BLOCKS) {
    return fail("INVALID_ARGS", `blocks must contain 1-${MAX_PLACE_BLOCKS} entries`);
  }
  const seen = new Set<string>();
  const blocks: PlaceBlocksArgs["blocks"] = [];
  for (const entry of args.blocks) {
    if (!entry || typeof entry !== "object") return fail("INVALID_ARGS", "each block must be an object");
    const position = parseVec3i((entry as Record<string, unknown>).position);
    const blockType = (entry as Record<string, unknown>).blockType;
    const states = parseBlockStates((entry as Record<string, unknown>).states);
    if (!position || !isNonEmptyString(blockType) || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(blockType)) {
      return fail("INVALID_ARGS", "each block needs integer position and namespaced block id");
    }
    if (states === null) return fail("INVALID_ARGS", "block states must be a bounded object of primitive state values");
    const key = `${position.x},${position.y},${position.z}`;
    if (seen.has(key)) return fail("DUPLICATE_POSITION", `duplicate block position ${key}`);
    seen.add(key);
    blocks.push({ position, blockType, ...(states && Object.keys(states).length ? { states } : {}) });
  }
  const batchSize = args.batchSize === undefined ? DEFAULT_BATCH_SIZE : args.batchSize;
  if (!Number.isInteger(batchSize) || (batchSize as number) < 1 || (batchSize as number) > DEFAULT_BATCH_SIZE) {
    return fail("INVALID_ARGS", `batchSize must be 1-${DEFAULT_BATCH_SIZE}`);
  }
  return ok({
    dimension: args.dimension,
    blocks,
    batchSize: batchSize as number,
    captureRollback: args.captureRollback === true,
  });
}

export function validateFillBlocks(args: Record<string, unknown>): ValidateResult<FillBlocksArgs> {
  if (!isDimensionId(args.dimension)) return fail("INVALID_ARGS", "dimension is required");
  const region = parseRegion(args.region);
  if (!region) return fail("INVALID_ARGS", "region must include min/max integer corners");
  const volume =
    (region.max.x - region.min.x + 1) *
    (region.max.y - region.min.y + 1) *
    (region.max.z - region.min.z + 1);
  if (volume > MAX_BUILD_VOLUME) {
    return fail("REGION_TOO_LARGE", `Build volume ${volume} exceeds max ${MAX_BUILD_VOLUME}`);
  }
  if (!isNonEmptyString(args.blockType) || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(args.blockType)) {
    return fail("INVALID_ARGS", "blockType must be a namespaced block id");
  }
  const batchSize = args.batchSize === undefined ? DEFAULT_BATCH_SIZE : args.batchSize;
  if (!Number.isInteger(batchSize) || (batchSize as number) < 1 || (batchSize as number) > DEFAULT_BATCH_SIZE) {
    return fail("INVALID_ARGS", `batchSize must be 1-${DEFAULT_BATCH_SIZE}`);
  }
  return ok({
    dimension: args.dimension,
    region,
    blockType: args.blockType,
    batchSize: batchSize as number,
    captureRollback: args.captureRollback === true,
  });
}

export function validateAdminRunCommand(
  args: Record<string, unknown>,
): ValidateResult<AdminRunCommandArgs> {
  if (!isNonEmptyString(args.commandId)) {
    return fail("INVALID_ARGS", "commandId is required");
  }
  if (args.command !== undefined && typeof args.command !== "string") {
    return fail("INVALID_ARGS", "command must be a string when present");
  }
  return ok({
    commandId: args.commandId,
    command: typeof args.command === "string" ? args.command : undefined,
  });
}
