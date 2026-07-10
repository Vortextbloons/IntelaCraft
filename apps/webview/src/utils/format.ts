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
