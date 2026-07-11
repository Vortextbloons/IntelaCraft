import { BlockTypes, EntityTypes, ItemTypes } from "@minecraft/server";
import type { ContentCatalogSnapshot } from "@intelacraft/shared-protocol";

let revision = 0;
export function collectCatalog(serverId: string): ContentCatalogSnapshot {
  const ids = (types: Array<{ id: string }>) => types.map((type) => type.id).filter(Boolean).sort();
  return { revision: ++revision, generatedAt: new Date().toISOString(), serverId, blocks: ids(BlockTypes.getAll()), items: ids(ItemTypes.getAll()), entities: ids(EntityTypes.getAll()) };
}
