import { MAX_CATALOG_IDS } from "@intelacraft/shared-protocol";
import type { CatalogKind, CatalogResolveResult, CatalogSearchResult, ContentCatalogSnapshot } from "@intelacraft/shared-protocol";

type Stored = Omit<ContentCatalogSnapshot, "blocks" | "items" | "entities"> & {
  blocks: Set<string>;
  items: Set<string>;
  entities: Set<string>;
  searchable: Record<CatalogKind, string[]>;
};

const idPattern = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
function searchable(id: string): string {
  return id.replace(":", " ").replace(/[\\/_-]+/g, " ").toLowerCase();
}

function tokens(value: string): string[] {
  return searchable(value).split(/\s+/).filter(Boolean);
}

function score(id: string, query: string): number {
  const text = searchable(id);
  const q = searchable(query).trim();
  if (!q) return 0;
  if (text === q || id.toLowerCase() === query.toLowerCase()) return 1;
  if (text.startsWith(q)) return .92;
  const qt = tokens(q);
  const tt = tokens(text);
  const matched = qt.filter((t) => tt.some((v) => v === t || v.startsWith(t))).length;
  if (matched) return .55 + .3 * matched / qt.length;
  let common = 0;
  for (let i = 0; i <= text.length - q.length; i++) {
    if (text.slice(i, i + q.length) === q) common++;
  }
  return common ? .35 : 0;
}

export class CatalogService {
  private catalogs = new Map<string, Stored>();
  private refreshRequests = new Set<string>();

  replace(sessionId: string, snapshot: ContentCatalogSnapshot): boolean {
    const current = this.catalogs.get(sessionId);
    if (current && snapshot.revision <= current.revision) return false;
    const make = (ids: string[]) => [...new Set(ids.filter((id) => idPattern.test(id)))].sort();
    if (
      snapshot.blocks.length > MAX_CATALOG_IDS ||
      snapshot.items.length > MAX_CATALOG_IDS ||
      snapshot.entities.length > MAX_CATALOG_IDS
    ) {
      throw new Error("Catalog exceeds maximum size");
    }
    const blocks = make(snapshot.blocks);
    const items = make(snapshot.items);
    const entities = make(snapshot.entities);
    this.catalogs.set(sessionId, {
      ...snapshot,
      blocks: new Set(blocks),
      items: new Set(items),
      entities: new Set(entities),
      searchable: { block: blocks, item: items, entity: entities },
    });
    this.refreshRequests.delete(sessionId);
    return true;
  }

  clear(sessionId: string): void {
    this.catalogs.delete(sessionId);
    this.refreshRequests.delete(sessionId);
  }

  requestRefresh(sessionId: string): boolean {
    this.refreshRequests.add(sessionId);
    return true;
  }

  consumeRefresh(sessionId: string): boolean {
    const requested = this.refreshRequests.has(sessionId);
    this.refreshRequests.delete(sessionId);
    return requested;
  }

  status(sessionId: string): {
    available: boolean;
    revision?: number;
    generatedAt?: string;
    counts: { blocks: number; items: number; entities: number };
  } {
    const c = this.catalogs.get(sessionId);
    return c
      ? {
          available: true,
          revision: c.revision,
          generatedAt: c.generatedAt,
          counts: {
            blocks: c.blocks.size,
            items: c.items.size,
            entities: c.entities.size,
          },
        }
      : { available: false, counts: { blocks: 0, items: 0, entities: 0 } };
  }

  get(sessionId: string): ContentCatalogSnapshot | undefined {
    const c = this.catalogs.get(sessionId);
    if (!c) return undefined;
    return {
      revision: c.revision,
      generatedAt: c.generatedAt,
      serverId: c.serverId,
      blocks: [...c.blocks],
      items: [...c.items],
      entities: [...c.entities],
    };
  }

  search(sessionId: string, kind: CatalogKind, query: string, limit = 8): CatalogSearchResult {
    const c = this.catalogs.get(sessionId);
    const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
    const ids = c?.searchable[kind] ?? [];
    const matches = ids
      .map((id) => ({ id, score: score(id, query) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, safeLimit);
    return { kind, query, matches, revision: c?.revision ?? 0 };
  }

  resolve(sessionId: string, kind: CatalogKind, id: string): CatalogResolveResult {
    const c = this.catalogs.get(sessionId);
    const key = kind === "block" ? "blocks" : kind === "item" ? "items" : "entities";
    const ids = c?.[key] as Set<string> | undefined;
    if (ids?.has(id)) return { valid: true, kind, id };
    return {
      valid: false,
      kind,
      id,
      suggestions: this.search(sessionId, kind, id, 3).matches.map((match) => match.id),
    };
  }
}
