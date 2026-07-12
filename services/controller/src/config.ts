import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionMode, RiskClass } from "@intelacraft/shared-protocol";

export interface AdminCommandEntry {
  command: string;
  risk: Exclude<RiskClass, "read" | "prohibited">;
  label: string;
}

export interface ControllerConfig {
  port: number;
  bdsToken: string;
  auditPath: string;
  auditRetentionDays: number;
  heartbeatStaleMs: number;
  protectedRegions: Array<{
    dimension: string;
    region: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  }>;
  builderRegions: Array<{
    dimension: string;
    region: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  }>;
  providerBaseUrl?: string;
  providerApiKey?: string;
  providerModel?: string;
  piStoragePath: string;
  providersPath: string;
  tasksPath?: string;
  buildLibraryPath?:string;
  voxelRendererPath?:string;
  temporaryRenderPath?:string;
  buildLibraryLimitBytes?:number;
  buildTrashRetentionDays?:number;
  mcpUrl?: string;
  mcpToken?: string;
  adminCommands: Record<string, AdminCommandEntry>;
  webviewDistPath: string;
  defaultPermissionMode: PermissionMode;
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
  const retention = Number(env.INTELACRAFT_AUDIT_RETENTION_DAYS ?? "30");
  const mode = (env.INTELACRAFT_PERMISSION_MODE ?? "confirm_every_change") as PermissionMode;
  return {
    port,
    bdsToken,
    auditPath,
    auditRetentionDays: Number.isFinite(retention) ? retention : 30,
    heartbeatStaleMs: Number(env.INTELACRAFT_HEARTBEAT_STALE_MS ?? "15000"),
    protectedRegions: parseRegions(env.INTELACRAFT_PROTECTED_REGIONS),
    builderRegions: parseRegions(env.INTELACRAFT_BUILDER_REGIONS),
    providerBaseUrl: env.INTELACRAFT_PROVIDER_BASE_URL,
    providerApiKey: env.INTELACRAFT_PROVIDER_API_KEY,
    providerModel: env.INTELACRAFT_PROVIDER_MODEL,
    piStoragePath: resolve(env.INTELACRAFT_PI_STORAGE_PATH ?? "./data/pi"),
    providersPath: resolve(env.INTELACRAFT_PROVIDERS_PATH ?? "./data/providers.json"),
    tasksPath: resolve(env.INTELACRAFT_TASKS_PATH ?? "./data/tasks.json"),
    buildLibraryPath:resolve(env.INTELACRAFT_BUILD_LIBRARY_PATH??"./data/builds"),
    voxelRendererPath:resolve(env.INTELACRAFT_VOXEL_RENDERER_PATH??"./services/voxel-renderer/voxel-renderer.exe"),
    temporaryRenderPath:resolve(env.INTELACRAFT_TEMP_RENDER_PATH??"./data/tmp/renders"),
    buildLibraryLimitBytes:Number(env.INTELACRAFT_BUILD_LIBRARY_LIMIT_BYTES??5*1024*1024*1024),
    buildTrashRetentionDays:Number(env.INTELACRAFT_BUILD_TRASH_RETENTION_DAYS??30),
    mcpUrl: env.INTELACRAFT_MCP_URL,
    mcpToken: env.INTELACRAFT_MCP_TOKEN,
    adminCommands: parseAdminCommands(env.INTELACRAFT_ADMIN_COMMANDS),
    webviewDistPath: resolve(
      env.INTELACRAFT_WEBVIEW_DIST ??
        resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/webview/dist"),
    ),
    defaultPermissionMode: mode,
  };
}

function parseRegions(raw: string | undefined): ControllerConfig["protectedRegions"] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    throw new Error("Region configuration must be valid JSON");
  }
}

function parseAdminCommands(raw: string | undefined): Record<string, AdminCommandEntry> {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new Error("not an object");
    }
    const out: Record<string, AdminCommandEntry> = {};
    for (const [id, entry] of Object.entries(v)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.command !== "string" || !e.command.trim()) continue;
      const risk = e.risk === "strong" ? "strong" : "normal";
      out[id] = {
        command: e.command.trim(),
        risk,
        label: typeof e.label === "string" ? e.label : id,
      };
    }
    return out;
  } catch {
    throw new Error("INTELACRAFT_ADMIN_COMMANDS must be valid JSON object");
  }
}
