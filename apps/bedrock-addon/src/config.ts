import { secrets, variables } from "@minecraft/server-admin";
import type { SecretString } from "@minecraft/server-admin";

export const CONTROLLER_URL_VAR = "intelacraft:controller_url";
export const BDS_TOKEN_SECRET = "intelacraft:bds_token";
export const SERVER_ID_VAR = "intelacraft:server_id";
export const PROTECTED_REGIONS_VAR = "intelacraft:protected_regions";
export const ADMIN_COMMANDS_VAR = "intelacraft:admin_commands";

export interface AddonConfig {
  controllerUrl: string;
  authToken: SecretString | string | undefined;
  serverId: string;
  configured: boolean;
  missing: string[];
  protectedRegions: Array<{dimension:string;region:{min:{x:number;y:number;z:number};max:{x:number;y:number;z:number}}}>;
  adminCommands: Record<string, { command: string; risk?: string; label?: string }>;
}

export function loadConfig(): AddonConfig {
  const missing: string[] = [];
  const controllerUrlRaw = variables.get(CONTROLLER_URL_VAR);
  const controllerUrl =
    typeof controllerUrlRaw === "string" ? controllerUrlRaw.trim().replace(/\/$/, "") : "";
  if (!controllerUrl) missing.push(CONTROLLER_URL_VAR);

  const authToken = secrets.get(BDS_TOKEN_SECRET);
  if (!authToken) missing.push(BDS_TOKEN_SECRET);

  const serverIdRaw = variables.get(SERVER_ID_VAR);
  const serverId =
    typeof serverIdRaw === "string" && serverIdRaw.trim().length > 0
      ? serverIdRaw.trim()
      : "bds-default";
  const protectedRaw=variables.get(PROTECTED_REGIONS_VAR); let protectedRegions:AddonConfig["protectedRegions"]=[];
  if(typeof protectedRaw==="string"&&protectedRaw.trim()){try{const parsed=JSON.parse(protectedRaw);if(Array.isArray(parsed))protectedRegions=parsed;}catch{missing.push(`${PROTECTED_REGIONS_VAR} (invalid JSON)`);}}
  const adminRaw=variables.get(ADMIN_COMMANDS_VAR); let adminCommands:AddonConfig["adminCommands"]={};
  if(typeof adminRaw==="string"&&adminRaw.trim()){try{const parsed=JSON.parse(adminRaw);if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))adminCommands=parsed;}catch{missing.push(`${ADMIN_COMMANDS_VAR} (invalid JSON)`);}}

  return {
    controllerUrl,
    authToken,
    serverId,
    configured: missing.length === 0,
    missing,
    protectedRegions,
    adminCommands,
  };
}
