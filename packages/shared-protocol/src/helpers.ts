import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from "./constants.js";
import type { RegionBounds, Vec3i } from "./types.js";

export function parseProtocolVersion(
  version: string,
): { major: number; minor: number; patch: number } | null {
  if (typeof version !== "string") return null;
  const parts = version.trim().split(".");
  if (parts.length !== 3) return null;
  const [major, minor, patch] = parts.map((p) => Number(p));
  if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0)) {
    return null;
  }
  return { major, minor, patch };
}

/** Fail closed when major versions differ. */
export function isProtocolCompatible(clientVersion: string): boolean {
  const parsed = parseProtocolVersion(clientVersion);
  if (!parsed) return false;
  return parsed.major === PROTOCOL_MAJOR;
}

export function currentProtocolVersion(): string {
  return PROTOCOL_VERSION;
}

export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseVec3i(value: unknown): Vec3i | null {
  if (!isRecord(value)) return null;
  if (!isInteger(value.x) || !isInteger(value.y) || !isInteger(value.z)) return null;
  return { x: value.x, y: value.y, z: value.z };
}

/** Normalize a region to inclusive min/max corners. */
export function normalizeRegion(a: Vec3i, b: Vec3i): RegionBounds {
  return {
    min: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      z: Math.min(a.z, b.z),
    },
    max: {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      z: Math.max(a.z, b.z),
    },
  };
}

export function parseRegion(value: unknown): RegionBounds | null {
  if (!isRecord(value)) return null;
  if (value.min !== undefined && value.max !== undefined) {
    const min = parseVec3i(value.min);
    const max = parseVec3i(value.max);
    if (!min || !max) return null;
    return normalizeRegion(min, max);
  }
  // Accept { from, to } aliases
  if (value.from !== undefined && value.to !== undefined) {
    const from = parseVec3i(value.from);
    const to = parseVec3i(value.to);
    if (!from || !to) return null;
    return normalizeRegion(from, to);
  }
  return null;
}

export function regionVolume(region: RegionBounds): number {
  const dx = region.max.x - region.min.x + 1;
  const dy = region.max.y - region.min.y + 1;
  const dz = region.max.z - region.min.z + 1;
  return dx * dy * dz;
}

export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}

export function createIdempotencyTracker(maxEntries = 2048) {
  const seen = new Map<string, number>();

  return {
    /** Returns true if this key was already seen (duplicate). */
    checkAndRemember(key: string, nowMs: number = Date.now()): boolean {
      if (seen.has(key)) return true;
      seen.set(key, nowMs);
      if (seen.size > maxEntries) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return false;
    },
    has(key: string): boolean {
      return seen.has(key);
    },
    clear(): void {
      seen.clear();
    },
  };
}

const SECRET_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key|bearer)/i;

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redactValue(v);
    }
  }
  return out;
}
