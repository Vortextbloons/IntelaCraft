#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureEnv, loadEnvFile, printBanner, REPO_ROOT, runNpm } from "./lib.mjs";

printBanner("Deploy Bedrock add-on");

ensureEnv();
loadEnvFile(join(REPO_ROOT, "apps", "bedrock-addon", ".env"));

const bdsPath =
  process.env.BDS_PATH?.trim() ||
  process.env.INTELACRAFT_BDS_PATH?.trim() ||
  "";

if (bdsPath) {
  // Full BDS setup: config merge + pack deploy + world enable
  runNpm(["run", "configure-bds"]);
  process.exit(0);
}

const envPath = join(REPO_ROOT, "apps", "bedrock-addon", ".env");
if (!existsSync(envPath) || !process.env.DEPLOY_PATH) {
  console.log("  Set BDS_PATH in the repo .env (preferred), or");
  console.log("  create apps/bedrock-addon/.env with DEPLOY_PATH.");
  console.log("");
  console.log("  Example:");
  console.log('    BDS_PATH=C:\\Users\\isaac\\Desktop\\DevServer');
  console.log("");
  process.exit(1);
}

runNpm(["run", "build", "-w", "@intelacraft/bedrock-addon"]);
runNpm(["run", "deploy:dev", "-w", "@intelacraft/bedrock-addon"]);

console.log("");
console.log("  Deployed. Reload the world / restart BDS if needed.");
console.log("  Tip: set BDS_PATH in .env to also write variables/secrets/permissions.");
console.log("");
