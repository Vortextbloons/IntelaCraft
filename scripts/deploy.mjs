#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { printBanner, REPO_ROOT, runNpm } from "./lib.mjs";

printBanner("Deploy Bedrock add-on (dev)");

const envPath = join(REPO_ROOT, "apps", "bedrock-addon", ".env");
if (!existsSync(envPath)) {
  console.log("  Missing apps/bedrock-addon/.env");
  console.log("  Create it with:");
  console.log("    DEPLOY_PATH=<Minecraft com.mojang or BDS worlds parent>");
  console.log("    DOWNLOAD_PATH=<folder for .mcaddon output>");
  console.log("");
  process.exit(1);
}

runNpm(["run", "build", "-w", "@intelacraft/bedrock-addon"]);
runNpm(["run", "deploy:dev", "-w", "@intelacraft/bedrock-addon"]);

console.log("");
console.log("  Deployed. Reload the world / restart BDS if needed.");
console.log("");
