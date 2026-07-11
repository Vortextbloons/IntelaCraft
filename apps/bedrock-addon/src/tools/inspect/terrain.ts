import type {
  InspectBuildCollisionArgs,
  InspectFindEmptyAreaArgs,
  InspectHeightmapArgs,
  InspectSurfaceArgs,
} from "@intelacraft/shared-protocol";
import { getDimension, surfaceAt, type ToolResult } from "./helpers.js";

export function inspectHeightmap(args: InspectHeightmapArgs, includeSurface: boolean): ToolResult {
  const d = getDimension(args.dimension);
  const samples: Array<Record<string, unknown>> = [];
  const r = args.region;
  const resolution = args.resolution ?? 1;
  for (let x = r.min.x; x <= r.max.x; x += resolution) {
    for (let z = r.min.z; z <= r.max.z; z += resolution) {
      const top = surfaceAt(d, x, z, r.min.y, r.max.y);
      samples.push({
        x,
        z,
        height: top?.y ?? null,
        ...(includeSurface ? { surfaceType: top?.typeId ?? "minecraft:air" } : {}),
      });
    }
  }
  const heights = samples.map((s) => s.height).filter((h): h is number => typeof h === "number");
  const min = heights.length ? Math.min(...heights) : null;
  const max = heights.length ? Math.max(...heights) : null;
  const average = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : null;
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      region: r,
      resolution,
      min,
      max,
      average,
      slope: min === null || max === null ? null : max - min,
      columns: samples,
    },
    completedWork: samples.length,
    totalEstimatedWork: samples.length,
    message: `Sampled ${samples.length} terrain columns`,
  };
}

export function inspectBuildCollision(args: InspectBuildCollisionArgs): ToolResult {
  const d = getDimension(args.dimension);
  const collisions: Array<Record<string, unknown>> = [];
  let checked = 0;
  for (let x = args.region.min.x; x <= args.region.max.x; x++) {
    for (let y = args.region.min.y; y <= args.region.max.y; y++) {
      for (let z = args.region.min.z; z <= args.region.max.z; z++) {
        checked++;
        const b = d.getBlock({ x, y, z });
        if (b?.isValid && !b.isAir) {
          collisions.push({ position: { x, y, z }, type: "block", blockType: b.typeId });
        }
      }
    }
  }
  const entities = d
    .getEntities()
    .filter((e) => {
      const p = e.location;
      return (
        p.x >= args.region.min.x &&
        p.x <= args.region.max.x + 1 &&
        p.y >= args.region.min.y &&
        p.y <= args.region.max.y + 1 &&
        p.z >= args.region.min.z &&
        p.z <= args.region.max.z + 1
      );
    })
    .map((e) => ({ type: "entity", id: e.id, typeId: e.typeId }));
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      region: args.region,
      nonAirBlocks: collisions.length,
      collisions: [...collisions, ...entities],
      worldHeightValid: args.region.min.y >= -64 && args.region.max.y <= 319,
    },
    completedWork: checked,
    totalEstimatedWork: checked,
    message: `Found ${collisions.length + entities.length} collision(s)`,
  };
}

export function inspectFindEmptyArea(args: InspectFindEmptyAreaArgs): ToolResult {
  const candidates: Array<Record<string, unknown>> = [];
  const d = getDimension(args.dimension);
  const step = Math.max(1, Math.ceil(args.requiredSize.x / 2));
  for (let dx = -args.radius; dx <= args.radius; dx += step) {
    for (let dz = -args.radius; dz <= args.radius; dz += step) {
      const min = { x: args.origin.x + dx, y: args.origin.y, z: args.origin.z + dz };
      const max = {
        x: min.x + args.requiredSize.x - 1,
        y: min.y + args.requiredSize.y - 1,
        z: min.z + args.requiredSize.z - 1,
      };
      const c = inspectBuildCollision({ dimension: args.dimension, region: { min, max } });
      if (c.ok) {
        const data = c.result as { nonAirBlocks: number };
        const heights = [
          surfaceAt(d, min.x, min.z, -64, 319),
          surfaceAt(d, max.x, min.z, -64, 319),
          surfaceAt(d, min.x, max.z, -64, 319),
          surfaceAt(d, max.x, max.z, -64, 319),
        ]
          .map((s) => s?.y)
          .filter((y): y is number => typeof y === "number");
        const slope = heights.length ? Math.max(...heights) - Math.min(...heights) : 999;
        if (args.maxSlope !== undefined && slope > args.maxSlope) continue;
        const suitable = heights.length === 4;
        candidates.push({
          region: { min, max },
          obstructions: data.nonAirBlocks,
          distance: Math.abs(dx) + Math.abs(dz),
          slope,
          surfaceSuitable: suitable,
          score:
            data.nonAirBlocks * 1000 +
            slope * 20 +
            Math.abs(dx) +
            Math.abs(dz) +
            (suitable ? 0 : 500),
        });
      }
    }
  }
  candidates.sort((a, b) => Number(a.score) - Number(b.score));
  return {
    ok: true,
    result: {
      dimension: args.dimension,
      requiredSize: args.requiredSize,
      maxSlope: args.maxSlope ?? null,
      candidates: candidates.slice(0, 8),
    },
    completedWork: candidates.length,
    totalEstimatedWork: candidates.length,
    message: `Ranked ${candidates.length} terrain-suitable candidate areas`,
  };
}

export function inspectSurface(args: InspectSurfaceArgs): ToolResult {
  return inspectHeightmap(args, true);
}
