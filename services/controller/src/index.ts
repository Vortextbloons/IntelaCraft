import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityStore } from "./activity.js";
import { AuditLog } from "./audit.js";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { loadControllerEnv } from "./env.js";
import { EventStore, SessionStore, SettingsStore } from "./store.js";
import { AgentRuntime } from "./agent.js";

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const serviceRoot = resolve(here, "..");
  const envPath = loadControllerEnv(serviceRoot);
  const config = loadConfig();
  const sessions = new SessionStore();
  const events = new EventStore();
  const activity = new ActivityStore(config.auditPath, config.auditRetentionDays);
  const audit = new AuditLog(config.auditPath, activity);
  const settings = new SettingsStore(config.defaultPermissionMode);
  const agent = new AgentRuntime(config);
  const server = createApp({ config, sessions, events, audit, activity, settings, agent });

  server.listen(config.port, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${config.port}`;
    console.log("");
    console.log("  IntelaCraft controller");
    console.log(`  listening  ${base}`);
    console.log(`  webview    ${base}/`);
    console.log(`  health     ${base}/v1/health`);
    console.log(`  audit      ${config.auditPath}`);
    if (envPath) {
      console.log(`  env        ${envPath}`);
    } else {
      console.log("  env        (none — using process env / defaults)");
    }
    console.log("");
    console.log("  Tip: npm run health");
    console.log("       open the webview at the URL above");
    console.log("");
  });
}

main();
