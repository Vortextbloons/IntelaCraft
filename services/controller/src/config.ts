import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface ControllerConfig {
  port: number;
  bdsToken: string;
  auditPath: string;
  heartbeatStaleMs: number;
  protectedRegions: Array<{dimension:string;region:{min:{x:number;y:number;z:number};max:{x:number;y:number;z:number}}}>;
  builderRegions: Array<{dimension:string;region:{min:{x:number;y:number;z:number};max:{x:number;y:number;z:number}}}>;
  providerBaseUrl?:string; providerApiKey?:string; providerModel?:string; piStoragePath:string; mcpUrl?:string; mcpToken?:string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ControllerConfig {
  const bdsToken = env.INTELACRAFT_BDS_TOKEN?.trim();
  if (!bdsToken) {
    throw new Error("INTELACRAFT_BDS_TOKEN is required");
  }
  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer 1-65535");
  }
  const auditPath = resolve(env.INTELACRAFT_AUDIT_PATH ?? "./data/audit.jsonl");
  mkdirSync(resolve(auditPath, ".."), { recursive: true });
  return {
    port,
    bdsToken,
    auditPath,
    heartbeatStaleMs: Number(env.INTELACRAFT_HEARTBEAT_STALE_MS ?? "15000"),
    protectedRegions: parseRegions(env.INTELACRAFT_PROTECTED_REGIONS),
    builderRegions: parseRegions(env.INTELACRAFT_BUILDER_REGIONS),
    providerBaseUrl:env.INTELACRAFT_PROVIDER_BASE_URL,providerApiKey:env.INTELACRAFT_PROVIDER_API_KEY,providerModel:env.INTELACRAFT_PROVIDER_MODEL,
    piStoragePath:resolve(env.INTELACRAFT_PI_STORAGE_PATH??"./data/pi"),mcpUrl:env.INTELACRAFT_MCP_URL,mcpToken:env.INTELACRAFT_MCP_TOKEN,
  };
}
function parseRegions(raw:string|undefined): ControllerConfig["protectedRegions"] { if(!raw)return []; try { const v=JSON.parse(raw); return Array.isArray(v)?v:[]; } catch { throw new Error("Region configuration must be valid JSON"); } }
