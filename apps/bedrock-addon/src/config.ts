import { secrets, variables } from "@minecraft/server-admin";
import type { SecretString } from "@minecraft/server-admin";

export const CONTROLLER_URL_VAR = "intelacraft:controller_url";
export const BDS_TOKEN_SECRET = "intelacraft:bds_token";
export const SERVER_ID_VAR = "intelacraft:server_id";

export interface AddonConfig {
  controllerUrl: string;
  authToken: SecretString | string | undefined;
  serverId: string;
  configured: boolean;
  missing: string[];
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

  return {
    controllerUrl,
    authToken,
    serverId,
    configured: missing.length === 0,
    missing,
  };
}
