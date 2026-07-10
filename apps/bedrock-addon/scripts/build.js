const { resolve } = require("path");
const { readFileSync } = require("fs");
const esbuild = require("esbuild");

const ROOT = resolve(__dirname, "..");

esbuild.buildSync({
  stdin: {
    contents: readFileSync(resolve(ROOT, "src/main.ts"), "utf8"),
    loader: "ts",
    resolveDir: resolve(ROOT, "src"),
    sourcefile: "src/main.ts",
  },
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: resolve(ROOT, "behavior_pack/scripts/main.js"),
  external: ["@minecraft/server", "@minecraft/server-ui"],
});
