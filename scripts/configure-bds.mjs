#!/usr/bin/env node
/**
 * Configure a Bedrock Dedicated Server for IntelaCraft.
 *
 * Reads from repo-root .env:
 *   BDS_PATH / INTELACRAFT_BDS_PATH  — path to bedrock_server folder
 *   INTELACRAFT_CONTROLLER_URL      — default http://127.0.0.1:8787
 *   INTELACRAFT_BDS_TOKEN           — shared bearer token
 *   INTELACRAFT_SERVER_ID           — optional server id
 *   INTELACRAFT_ADMIN_COMMANDS      — optional JSON allowlist string
 *
 * Writes/merges:
 *   <BDS>/config/default/variables.json
 *   <BDS>/config/default/secrets.json
 *   <BDS>/config/default/permissions.json
 *
 * With --deploy (default): also copies packs into development_*_packs
 * and enables them on worlds under <BDS>/worlds.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { ensureEnv, printBanner, REPO_ROOT, runNpm } from "./lib.mjs";

const BP_UUID = "f6606124-59dd-4de1-aa92-a43a4f8fc46c";
const RP_UUID = "9eb10a28-5085-4b04-8e76-70302a1ff48e";
const PACK_VERSION = [1, 0, 0];
const BP_DEST_NAME = "IntelaCraft_bp";
const RP_DEST_NAME = "IntelaCraft_rp";

const REQUIRED_MODULES = [
  "@minecraft/server",
  "@minecraft/server-ui",
  "@minecraft/server-net",
  "@minecraft/server-admin",
];

function readJson(path, fallback) {
  if (!existsSync(path)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.error(`  Warning: invalid JSON at ${path}; recreating from merge base`);
    return structuredClone(fallback);
  }
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveBdsPath(env) {
  const raw =
    process.env.BDS_PATH?.trim() ||
    process.env.INTELACRAFT_BDS_PATH?.trim() ||
    env.BDS_PATH?.trim() ||
    env.INTELACRAFT_BDS_PATH?.trim() ||
    process.env.DEPLOY_PATH?.trim() ||
    "";
  return raw.replace(/[\\/]+$/, "");
}

function mergeVariables(existing, opts) {
  const next = { ...existing };
  next["intelacraft:controller_url"] = opts.controllerUrl;
  next["intelacraft:server_id"] = opts.serverId;
  if (opts.adminCommands) {
    next["intelacraft:admin_commands"] =
      typeof opts.adminCommands === "string"
        ? opts.adminCommands
        : JSON.stringify(opts.adminCommands);
  }
  if (opts.protectedRegions) {
    next["intelacraft:protected_regions"] =
      typeof opts.protectedRegions === "string"
        ? opts.protectedRegions
        : JSON.stringify(opts.protectedRegions);
  }
  return next;
}

function mergeSecrets(existing, token) {
  // SecretString is passed straight into the Authorization header and cannot be
  // concatenated in script — store the full "Bearer <token>" value.
  const authValue = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
  return {
    ...existing,
    "intelacraft:bds_token": authValue,
  };
}

function mergePermissions(existing) {
  const allowed = Array.isArray(existing.allowed_modules)
    ? [...existing.allowed_modules]
    : [];
  for (const mod of REQUIRED_MODULES) {
    if (!allowed.includes(mod)) allowed.push(mod);
  }
  return { ...existing, allowed_modules: allowed };
}

function enablePackOnWorld(worldDir) {
  const bpPath = join(worldDir, "world_behavior_packs.json");
  const rpPath = join(worldDir, "world_resource_packs.json");
  const bp = readJson(bpPath, []);
  const rp = readJson(rpPath, []);
  const bpList = Array.isArray(bp) ? bp : [];
  const rpList = Array.isArray(rp) ? rp : [];
  if (!bpList.some((p) => p.pack_id === BP_UUID)) {
    bpList.push({ pack_id: BP_UUID, version: PACK_VERSION });
  }
  if (!rpList.some((p) => p.pack_id === RP_UUID)) {
    rpList.push({ pack_id: RP_UUID, version: PACK_VERSION });
  }
  writeJson(bpPath, bpList);
  writeJson(rpPath, rpList);
}

function enablePacksOnAllWorlds(bdsPath) {
  const worldsRoot = join(bdsPath, "worlds");
  if (!existsSync(worldsRoot)) return [];
  const enabled = [];
  for (const name of readdirSync(worldsRoot, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const worldDir = join(worldsRoot, name.name);
    if (!existsSync(join(worldDir, "levelname.txt")) && !existsSync(join(worldDir, "db"))) {
      continue;
    }
    enablePackOnWorld(worldDir);
    enabled.push(name.name);
  }
  return enabled;
}

function deployPacks(bdsPath) {
  const bpSrc = join(REPO_ROOT, "apps", "bedrock-addon", "behavior_pack");
  const rpSrc = join(REPO_ROOT, "apps", "bedrock-addon", "resource_pack");
  if (!existsSync(join(bpSrc, "scripts", "main.js"))) {
    console.log("  Building bedrock add-on…");
    runNpm(["run", "build", "-w", "@intelacraft/bedrock-addon"]);
  }
  const bDest = join(bdsPath, "development_behavior_packs", BP_DEST_NAME);
  const rDest = join(bdsPath, "development_resource_packs", RP_DEST_NAME);
  rmSync(bDest, { recursive: true, force: true });
  rmSync(rDest, { recursive: true, force: true });
  mkdirSync(bDest, { recursive: true });
  mkdirSync(rDest, { recursive: true });
  cpSync(bpSrc, bDest, { recursive: true, force: true });
  cpSync(rpSrc, rDest, { recursive: true, force: true });
  return { bDest, rDest };
}

function syncAddonEnv(bdsPath) {
  const addonEnv = join(REPO_ROOT, "apps", "bedrock-addon", ".env");
  const lines = existsSync(addonEnv)
    ? readFileSync(addonEnv, "utf8").split(/\r?\n/)
    : [];
  const map = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) map[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  map.DEPLOY_PATH = bdsPath;
  if (!map.DOWNLOAD_PATH) map.DOWNLOAD_PATH = join(REPO_ROOT, "dist");
  const out = Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(addonEnv, `${out}\n`, "utf8");
}

function main() {
  printBanner("Configure BDS for IntelaCraft");
  const fileEnv = ensureEnv();
  const args = new Set(process.argv.slice(2));
  const skipDeploy = args.has("--config-only");
  const bdsPath = resolveBdsPath(fileEnv);

  if (!bdsPath) {
    console.log("  Set BDS_PATH in the repo .env to your Bedrock Dedicated Server folder.");
    console.log("  Example:");
    console.log('    BDS_PATH=C:\\Users\\isaac\\Desktop\\DevServer');
    console.log("");
    console.log("  Then run:  npm run configure-bds");
    console.log("");
    process.exit(1);
  }

  if (!existsSync(bdsPath)) {
    console.error(`  BDS_PATH does not exist: ${bdsPath}`);
    process.exit(1);
  }
  if (!existsSync(join(bdsPath, "bedrock_server.exe")) && !existsSync(join(bdsPath, "bedrock_server"))) {
    console.log(`  Warning: no bedrock_server binary found in ${bdsPath}`);
    console.log("  Continuing anyway (config + packs only).");
  }

  const controllerUrl = (
    process.env.INTELACRAFT_CONTROLLER_URL ??
    `http://127.0.0.1:${process.env.PORT ?? "8787"}`
  ).replace(/\/$/, "");
  const token = process.env.INTELACRAFT_BDS_TOKEN ?? "dev-change-me";
  const serverId = process.env.INTELACRAFT_SERVER_ID ?? "bds-default";
  const adminCommands =
    process.env.INTELACRAFT_ADMIN_COMMANDS?.trim() ||
    JSON.stringify({
      time_day: { command: "time set day", risk: "normal", label: "Set time to day" },
    });
  const protectedRegions = process.env.INTELACRAFT_PROTECTED_REGIONS?.trim() || "[]";

  const configDir = join(bdsPath, "config", "default");
  mkdirSync(configDir, { recursive: true });

  const variablesPath = join(configDir, "variables.json");
  const secretsPath = join(configDir, "secrets.json");
  const permissionsPath = join(configDir, "permissions.json");

  const variables = mergeVariables(readJson(variablesPath, {}), {
    controllerUrl,
    serverId,
    adminCommands,
    protectedRegions,
  });
  const secrets = mergeSecrets(readJson(secretsPath, {}), token);
  const permissions = mergePermissions(readJson(permissionsPath, { allowed_modules: [] }));

  writeJson(variablesPath, variables);
  writeJson(secretsPath, secrets);
  writeJson(permissionsPath, permissions);

  console.log(`  BDS        ${bdsPath}`);
  console.log(`  variables  ${variablesPath}`);
  console.log(`  secrets    ${secretsPath}  (intelacraft:bds_token merged)`);
  console.log(`  permissions ${permissionsPath}`);
  console.log(`  controller ${controllerUrl}`);
  console.log(`  serverId   ${serverId}`);

  syncAddonEnv(bdsPath);
  console.log("  synced     apps/bedrock-addon/.env DEPLOY_PATH");

  if (!skipDeploy) {
    const { bDest, rDest } = deployPacks(bdsPath);
    console.log(`  deployed   ${bDest}`);
    console.log(`  deployed   ${rDest}`);
    const worlds = enablePacksOnAllWorlds(bdsPath);
    if (worlds.length) {
      console.log(`  enabled on world(s): ${worlds.join(", ")}`);
    } else {
      console.log("  No worlds found to enable packs on.");
    }
  }

  console.log("");
  console.log("  Next: restart BDS, keep npm run dev running, check webview BDS status.");
  console.log("");
}

main();
