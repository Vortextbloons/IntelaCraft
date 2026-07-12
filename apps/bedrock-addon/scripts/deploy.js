const { execFileSync, execSync } = require("child_process");
const { createHash } = require("crypto");
const { existsSync, cpSync, mkdirSync, rmSync, readFileSync, renameSync } = require("fs");
const { resolve, join } = require("path");

const ROOT = resolve(__dirname, "..");
const BP_SRC = join(ROOT, "behavior_pack");
const RP_SRC = join(ROOT, "resource_pack");
const BP_DEST_NAME = "IntelaCraft_bp";
const RP_DEST_NAME = "IntelaCraft_rp";
const ADDON_NAME = "IntelaCraft";

function readEnv(key) {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return "";
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eq = trimmed.indexOf("=");
      if (eq > 0 && trimmed.slice(0, eq).trim() === key) {
        return trimmed.slice(eq + 1).trim();
      }
    }
  }
  return "";
}

function build() {
  execFileSync(process.execPath, [join(ROOT, "scripts", "build.js")], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyCopy(source, destination) {
  if (!existsSync(destination) || fileHash(source) !== fileHash(destination)) {
    throw new Error(`Deployment verification failed for ${destination}`);
  }
}

function dev() {
  const skipBuild = process.env.SKIP_BUILD || process.argv.includes("--skip-build");
  if (!skipBuild) build();
  const mcDev = readEnv("DEPLOY_PATH");
  if (!mcDev) {
    console.error("DEPLOY_PATH not set in .env");
    process.exit(1);
  }
  const bDest = join(mcDev, "development_behavior_packs", BP_DEST_NAME);
  rmSync(bDest, { recursive: true, force: true });
  mkdirSync(bDest, { recursive: true });
  cpSync(BP_SRC, bDest, { recursive: true, force: true });
  console.log("Deployed BP: " + bDest);
  const rDest = join(mcDev, "development_resource_packs", RP_DEST_NAME);
  rmSync(rDest, { recursive: true, force: true });
  mkdirSync(rDest, { recursive: true });
  cpSync(RP_SRC, rDest, { recursive: true, force: true });
  console.log("Deployed RP: " + rDest);
  verifyCopy(join(BP_SRC, "scripts", "main.js"), join(bDest, "scripts", "main.js"));
  verifyCopy(join(BP_SRC, "manifest.json"), join(bDest, "manifest.json"));
  verifyCopy(join(RP_SRC, "manifest.json"), join(rDest, "manifest.json"));
  console.log("Verified deployed pack files match the generated pack");
}

function prod() {
  if (!process.env.SKIP_BUILD) build();
  const outPath = readEnv("DOWNLOAD_PATH");
  if (!outPath) {
    console.error("DOWNLOAD_PATH not set in .env");
    process.exit(1);
  }
  const tempDir = join(ROOT, "temp_release");
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });

  console.log("Zipping behavior pack...");
  const bpZip = join(tempDir, ADDON_NAME + "_BP.zip");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${BP_SRC}\\*' -DestinationPath '${bpZip}' -Force"`, { stdio: "pipe" });
  const bpMcpack = join(tempDir, ADDON_NAME + "_BP.mcpack");
  renameSync(bpZip, bpMcpack);
  const packs = ["'" + bpMcpack + "'"];
  console.log("Zipping resource pack...");
  const rpZip = join(tempDir, ADDON_NAME + "_RP.zip");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${RP_SRC}\\*' -DestinationPath '${rpZip}' -Force"`, { stdio: "pipe" });
  const rpMcpack = join(tempDir, ADDON_NAME + "_RP.mcpack");
  renameSync(rpZip, rpMcpack);
  packs.push("'" + rpMcpack + "'");
  console.log("Creating .mcaddon...");
  const releaseName = process.env.DEV_PACK === "1" ? ADDON_NAME + "-dev" : ADDON_NAME;
  const addonZip = join(tempDir, releaseName + ".zip");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path ${packs.join(',')} -DestinationPath '${addonZip}' -Force"`, { stdio: "pipe" });

  const outputPath = join(outPath, releaseName + ".mcaddon");
  renameSync(addonZip, outputPath);
  rmSync(tempDir, { recursive: true });
  console.log("Created " + outputPath);
}

const cmd = process.argv[2];
if (cmd === "dev") dev();
else if (cmd === "prod") prod();
else if (cmd === "compile") build();
else {
  console.log("Usage: node scripts/deploy.js <dev|prod|compile>");
  console.log("  dev     - Build and deploy to Minecraft development folders");
  console.log("  prod    - Build and create .mcaddon for distribution");
  console.log("  compile - Copy/compile scripts only (used by npm run build)");
  console.log("");
  console.log("To package interactively, run: npm run bundle");
  process.exit(1);
}
