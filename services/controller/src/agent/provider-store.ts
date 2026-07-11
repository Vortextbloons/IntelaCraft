import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  discoverModels,
  publicProfile,
  testProvider,
  type ProviderProfile,
} from "@intelacraft/pi-extension";
import type { AgentContext } from "./types.js";
import { sanitizeApiKey } from "./sanitize.js";

interface ProvidersFile {
  activeProviderId: string;
  providers: ProviderProfile[];
}

export function loadProviders(ctx: AgentContext): void {
  try {
    if (!existsSync(ctx.config.providersPath)) return;
    const raw = JSON.parse(readFileSync(ctx.config.providersPath, "utf8")) as ProvidersFile;
    const rows = Array.isArray(raw?.providers) ? raw.providers : [];
    for (const row of rows) {
      if (!row?.id || !row.baseUrl || !row.apiKey || !row.model) continue;
      let apiKey: string;
      try {
        apiKey = sanitizeApiKey(String(row.apiKey));
      } catch {
        console.error(`Skipping provider ${row.id}: invalid API key in providers.json`);
        continue;
      }
      ctx.profiles.set(row.id, {
        id: String(row.id),
        name: String(row.name || row.id),
        baseUrl: String(row.baseUrl).replace(/\/$/, ""),
        apiKey,
        model: String(row.model),
      });
    }
    const active = String(raw.activeProviderId ?? "");
    ctx.activeProviderId =
      (active && ctx.profiles.has(active) && active) ||
      ctx.profiles.keys().next().value ||
      "";
  } catch (err) {
    console.error("Failed to load providers file:", err);
  }
}

export function persistProviders(ctx: AgentContext): void {
  const payload: ProvidersFile = {
    activeProviderId: ctx.activeProviderId,
    providers: [...ctx.profiles.values()],
  };
  writeFileSync(ctx.config.providersPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function saveProvider(ctx: AgentContext, p: Partial<ProviderProfile> & Pick<ProviderProfile, "id">) {
  const prev = ctx.profiles.get(p.id);
  const baseUrl = (p.baseUrl ?? prev?.baseUrl ?? "").replace(/\/$/, "");
  const model = p.model ?? prev?.model ?? "";
  let apiKey = p.apiKey?.trim() || prev?.apiKey || "";
  if (p.apiKey != null && p.apiKey.trim()) {
    apiKey = sanitizeApiKey(p.apiKey);
  }
  if (!p.id || !baseUrl || !model) {
    throw new Error("Provider id, baseUrl, and model are required");
  }
  if (!apiKey) throw new Error("API key is required — connect the provider first");
  const next: ProviderProfile = {
    id: p.id,
    name: p.name || prev?.name || p.id,
    baseUrl,
    apiKey,
    model,
  };
  ctx.profiles.set(p.id, next);
  ctx.activeProviderId = p.id;
  persistProviders(ctx);
  return publicProfile(next);
}

export function setActiveProvider(ctx: AgentContext, id: string) {
  if (!ctx.profiles.has(id)) throw new Error("Unknown provider profile");
  ctx.activeProviderId = id;
  persistProviders(ctx);
  return getActiveProvider(ctx);
}

export function getActiveProvider(ctx: AgentContext) {
  const id =
    (ctx.activeProviderId && ctx.profiles.has(ctx.activeProviderId) && ctx.activeProviderId) ||
    ctx.profiles.keys().next().value ||
    "";
  return {
    activeProviderId: id,
    provider: id ? publicProfile(ctx.profiles.get(id)!) : null,
  };
}

export function listProviders(ctx: AgentContext) {
  return [...ctx.profiles.values()].map(publicProfile);
}

export async function testProviderById(ctx: AgentContext, id: string) {
  return testProvider(needProvider(ctx, id));
}

export async function modelsForProvider(ctx: AgentContext, id: string) {
  return discoverModels(needProvider(ctx, id));
}

export function needProvider(ctx: AgentContext, id: string) {
  const p = ctx.profiles.get(id);
  if (!p) throw new Error("Unknown provider profile");
  return p;
}
