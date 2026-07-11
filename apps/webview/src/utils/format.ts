export type Vec3 = { x: number; y: number; z: number };

export type ParsedToolResult = {
  summary: string;
  data?: unknown;
};

export type ToolResultFacts = {
  dimension?: string;
  region?: { min: Vec3; max: Vec3 };
  position?: Vec3;
  blockType?: string;
  count?: number;
  layers?: number;
};

export function formatInspectResult(message: string, result: unknown): string {
  if (result && typeof result === "object") {
    const r = result as {
      count?: number;
      players?: Array<{
        name?: string;
        dimension?: string;
        location?: { x: number; y: number; z: number };
      }>;
      blockType?: string;
      dimension?: string;
      position?: { x: number; y: number; z: number };
    };
    if (Array.isArray(r.players)) {
      if (r.players.length === 0) return "No players online.";
      const lines = r.players.map((p) => {
        const loc = p.location
          ? ` @ ${Math.round(p.location.x)}, ${Math.round(p.location.y)}, ${Math.round(p.location.z)}`
          : "";
        return `• ${p.name ?? "?"}${p.dimension ? ` (${p.dimension})` : ""}${loc}`;
      });
      return `${message}\n${lines.join("\n")}`;
    }
    if (r.blockType && r.position) {
      return `${message}\n${r.blockType} at ${r.position.x}, ${r.position.y}, ${r.position.z}${
        r.dimension ? ` (${r.dimension})` : ""
      }`;
    }
  }
  if (result !== undefined) {
    return `${message}\n${JSON.stringify(result, null, 2)}`;
  }
  return message;
}

/** Split a tool result blob into a human summary line + optional JSON payload. */
export function parseToolResultText(text: string): ParsedToolResult {
  const trimmed = text.trim();
  if (!trimmed) return { summary: "" };

  const jsonStart = trimmed.search(/[\[{]/);
  if (jsonStart === -1) return { summary: trimmed };

  const maybeJson = trimmed.slice(jsonStart);
  try {
    const data = JSON.parse(maybeJson) as unknown;
    const summary = trimmed.slice(0, jsonStart).trim();
    return { summary, data };
  } catch {
    return { summary: trimmed };
  }
}

export function extractToolResultFacts(data: unknown): ToolResultFacts | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  const facts: ToolResultFacts = {};

  if (typeof r.dimension === "string") facts.dimension = r.dimension;
  if (typeof r.blockType === "string") facts.blockType = r.blockType;
  if (typeof r.count === "number") facts.count = r.count;
  if (typeof r.changed === "number") facts.count = r.changed;
  if (typeof r.blocksChanged === "number") facts.count = r.blocksChanged;

  const pos = r.position as Vec3 | undefined;
  if (pos && typeof pos.x === "number" && typeof pos.y === "number" && typeof pos.z === "number") {
    facts.position = pos;
  }

  const region = r.region as { min?: Vec3; max?: Vec3 } | undefined;
  if (
    region?.min &&
    region?.max &&
    typeof region.min.x === "number" &&
    typeof region.max.x === "number"
  ) {
    facts.region = { min: region.min, max: region.max };
    facts.layers = Math.abs(region.max.y - region.min.y) + 1;
  }

  if (
    !facts.dimension &&
    !facts.region &&
    !facts.position &&
    !facts.blockType &&
    facts.count === undefined
  ) {
    return null;
  }
  return facts;
}

export function formatCoord(v: Vec3): string {
  return `${v.x}, ${v.y}, ${v.z}`;
}

export function shortDimension(dim: string): string {
  return dim.replace(/^minecraft:/, "");
}

export function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args || !Object.keys(args).length) return "";
  const bits: string[] = [];
  if (typeof args.dimension === "string") bits.push(String(args.dimension).replace(/^minecraft:/, ""));
  const region = args.region as
    | { min?: { x: number; y: number; z: number }; max?: { x: number; y: number; z: number } }
    | undefined;
  if (region?.min && region?.max) {
    bits.push(
      `(${region.min.x},${region.min.y},${region.min.z})→(${region.max.x},${region.max.y},${region.max.z})`,
    );
  }
  const pos = args.position as { x?: number; y?: number; z?: number } | undefined;
  if (pos && typeof pos.x === "number") bits.push(`${pos.x}, ${pos.y}, ${pos.z}`);
  if (typeof args.blockType === "string") bits.push(String(args.blockType).replace(/^minecraft:/, ""));
  if (typeof args.commandId === "string") bits.push(`cmd:${args.commandId}`);
  if (typeof args.nameFilter === "string") bits.push(`filter:${args.nameFilter}`);
  if (!bits.length) {
    const raw = JSON.stringify(args);
    return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  }
  return bits.join(" · ");
}

export function estimateFillBlocks(args: Record<string, unknown> | undefined): number | null {
  const region = args?.region as
    | { min?: { x: number; y: number; z: number }; max?: { x: number; y: number; z: number } }
    | undefined;
  if (!region?.min || !region?.max) return null;
  const dx = Math.abs(region.max.x - region.min.x) + 1;
  const dy = Math.abs(region.max.y - region.min.y) + 1;
  const dz = Math.abs(region.max.z - region.min.z) + 1;
  return dx * dy * dz;
}

/** Safe markdown-ish rendering: escape HTML, then light formatting. */
export function renderSafeMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}
