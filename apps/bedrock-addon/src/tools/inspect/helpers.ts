import { world } from "@minecraft/server";
import type { DimensionId } from "@intelacraft/shared-protocol";

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

export function getDimension(id: DimensionId) {
  return world.getDimension(id);
}

export function surfaceAt(
  dimension: ReturnType<typeof getDimension>,
  x: number,
  z: number,
  fromY: number,
  toY: number,
) {
  for (let y = toY; y >= fromY; y--) {
    const block = dimension.getBlock({ x, y, z });
    if (block?.isValid && !block.isAir && !block.isLiquid) {
      return { y, typeId: block.typeId };
    }
  }
  return null;
}
