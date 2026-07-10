#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureEnv, printBanner, REPO_ROOT, runNpm } from "./lib.mjs";

printBanner("IntelaCraft controller");

const { port, token, baseUrl } = ensureEnv();

if (!existsSync(join(REPO_ROOT, "services", "controller", "dist", "index.js"))) {
  console.log("  Building controller...");
  runNpm(["run", "build", "-w", "@intelacraft/shared-protocol"]);
  runNpm(["run", "build", "-w", "@intelacraft/controller"]);
}

console.log(`  URL     ${baseUrl}`);
console.log(`  Port    ${port}`);
console.log(`  Token   ${token.slice(0, 4)}${"*".repeat(Math.max(0, token.length - 4))}`);
console.log("");
console.log("  Ctrl+C to stop");
console.log("");

const child = spawn(
  process.execPath,
  [join(REPO_ROOT, "services", "controller", "dist", "index.js")],
  {
    cwd: join(REPO_ROOT, "services", "controller"),
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      INTELACRAFT_BDS_TOKEN: token,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
