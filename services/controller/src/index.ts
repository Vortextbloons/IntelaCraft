import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditLog } from "./audit.js";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { loadControllerEnv } from "./env.js";
import { EventStore, SessionStore } from "./store.js";
import { AgentRuntime } from "./agent.js";

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const serviceRoot = resolve(here, "..");
  const envPath = loadControllerEnv(serviceRoot);
  const config = loadConfig();
  const sessions = new SessionStore();
  const events = new EventStore();
  const audit = new AuditLog(config.auditPath);
  const agent=new AgentRuntime(config);
  const server = createApp({ config, sessions, events, audit,agent });

  server.listen(config.port, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${config.port}`;
    console.log("");
    console.log("  IntelaCraft controller");
    console.log(`  listening  ${base}`);
    console.log(`  health     ${base}/v1/health`);
    console.log(`  audit      ${config.auditPath}`);
    if (envPath) {
      console.log(`  env        ${envPath}`);
    } else {
      console.log("  env        (none — using process env / defaults)");
    }
    console.log("");
    console.log("  Tip: npm run health");
    console.log("       npm run inspect -- players");
    console.log("");
  });
}

main();
