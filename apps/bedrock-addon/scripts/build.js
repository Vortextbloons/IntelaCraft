const { resolve } = require("path");
const esbuild = require("esbuild");

const ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(ROOT, "../..");

esbuild.buildSync({
  absWorkingDir: REPO_ROOT,
  entryPoints: [resolve(ROOT, "src/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: resolve(ROOT, "behavior_pack/scripts/main.js"),
  external: [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-net",
    "@minecraft/server-admin",
  ],
  alias: {
    "@intelacraft/shared-protocol": resolve(
      REPO_ROOT,
      "packages/shared-protocol/src/index.ts",
    ),
  },
});

console.log("Built behavior_pack/scripts/main.js");
