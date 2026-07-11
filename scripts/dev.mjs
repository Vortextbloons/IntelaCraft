#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { ensureEnv, printBanner, REPO_ROOT, runNpm } from "./lib.mjs";

printBanner("IntelaCraft controller");

const { port, token, baseUrl } = ensureEnv();

// Workspace packages are executed from dist/. Always rebuild the controller
// bridge and its runtime dependencies so `npm run dev` cannot start stale code
// after an add-on or inspection-tool change.
console.log("  Building controller bridge...");
runNpm(["run", "build", "-w", "@intelacraft/shared-protocol"]);
runNpm(["run", "build", "-w", "@intelacraft/prompts"]);
runNpm(["run", "build", "-w", "@intelacraft/pi-extension"]);
runNpm(["run", "build", "-w", "@intelacraft/mcp-connection"]);
runNpm(["run", "build", "-w", "@intelacraft/controller"]);

const vitePort = 5173;

console.log(`  Controller  ${baseUrl}`);
console.log(`  Webview     http://localhost:${vitePort}`);
console.log(`  Port        ${port}`);
console.log(`  Token       ${token.slice(0, 4)}${"*".repeat(Math.max(0, token.length - 4))}`);
console.log("");
console.log("  Ctrl+C to stop");
console.log("");

const controller = spawn(
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

const vite = spawn(
  process.execPath,
  [join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js")],
  {
    cwd: join(REPO_ROOT, "apps", "webview"),
    stdio: "inherit",
    env: {
      ...process.env,
    },
  },
);

let exiting = false;

function cleanup() {
  if (exiting) return;
  exiting = true;
  controller.kill("SIGTERM");
  vite.kill("SIGTERM");
}

controller.on("exit", (code, signal) => {
  if (!exiting && !signal) {
    cleanup();
    process.exit(code ?? 0);
  }
});

vite.on("exit", () => {
  if (!exiting) {
    cleanup();
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
  });
}
