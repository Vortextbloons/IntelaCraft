#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureEnv, printBanner, REPO_ROOT, runNpm } from "./lib.mjs";

printBanner("IntelaCraft setup");

ensureEnv();

console.log("  Installing workspace dependencies...");
runNpm(["install"]);

console.log("  Building packages...");
runNpm(["run", "build"]);

const addonEnv = join(REPO_ROOT, "apps", "bedrock-addon", ".env");
if (!existsSync(addonEnv)) {
  console.log("");
  console.log("  Note: apps/bedrock-addon/.env is missing.");
  console.log("  Add DEPLOY_PATH / DOWNLOAD_PATH before npm run deploy.");
}

console.log("");
console.log("  Ready. Next:");
console.log("    npm run build        build packs + webview");
console.log("    npm run dev          start the controller (serves UI at /)");
console.log("    open http://127.0.0.1:8787/");
console.log("    npm run health       check controller + BDS link");
console.log("    npm run inspect -- players");
console.log("    npm run deploy       build + deploy Bedrock packs");
console.log("");
