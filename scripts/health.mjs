#!/usr/bin/env node
import { api, ensureEnv, printBanner } from "./lib.mjs";

printBanner("IntelaCraft health");

const { baseUrl, token } = ensureEnv();

try {
  const res = await api(baseUrl, "/v1/health");
  if (!res.ok) {
    console.log(`  Controller responded ${res.status}`);
    console.log(JSON.stringify(res.json, null, 2));
    process.exit(1);
  }

  const data = res.json;
  console.log(`  Controller   ok`);
  console.log(`  Protocol     ${data.protocolVersion}`);
  console.log(`  BDS linked   ${data.bdsConnected ? "yes" : "no"}`);

  const sessions = data.sessions ?? [];
  if (sessions.length === 0) {
    console.log("  Sessions     none (start BDS with the IntelaCraft pack)");
  } else {
    for (const s of sessions) {
      const age =
        s.heartbeatAgeMs == null ? "n/a" : `${Math.round(s.heartbeatAgeMs / 1000)}s ago`;
      console.log(
        `  Session      ${s.serverId}  connected=${s.connected}  heartbeat=${age}  players=${s.health?.playerCount ?? "?"}`,
      );
    }
  }

  // Also probe auth quickly
  const events = await api(baseUrl, "/v1/events", { token });
  if (events.status === 401) {
    console.log("  Auth         FAIL (token mismatch — check .env)");
    process.exit(1);
  }
  console.log(`  Auth         ok`);
  console.log(`  Recent ops   ${(events.json?.events ?? []).length}`);
  console.log("");
} catch (err) {
  console.log(`  Controller unreachable at ${baseUrl}`);
  console.log(`  ${err instanceof Error ? err.message : String(err)}`);
  console.log("");
  console.log("  Start it with:  npm run dev");
  console.log("");
  process.exit(1);
}
