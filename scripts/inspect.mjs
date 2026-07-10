#!/usr/bin/env node
import { api, ensureEnv, printBanner } from "./lib.mjs";

const TOOL_ALIASES = {
  players: "inspect.players",
  status: "inspect.server_status",
  server: "inspect.server_status",
  time: "inspect.time",
  weather: "inspect.weather",
  rules: "inspect.game_rules",
  gamerules: "inspect.game_rules",
  block: "inspect.block",
  region: "inspect.region",
  entities: "inspect.entities",
  scoreboard: "inspect.scoreboard",
  tags: "inspect.tags",
};

function usage() {
  console.log(`
  Usage: npm run inspect -- <tool> [json-args]

  Tools:
    players              list online players
    status               server status
    time                 world time
    weather              weather
    rules                selected game rules
    entities             entities in a dimension (needs dimension)
    scoreboard           scoreboard objectives
    tags                 tags for a player/entity (needs target)
    block                needs args: '{"dimension":"minecraft:overworld","position":{"x":0,"y":64,"z":0}}'
    region               needs args: '{"dimension":"minecraft:overworld","region":{"min":{"x":0,"y":64,"z":0},"max":{"x":3,"y":66,"z":3}}}'

  Examples:
    npm run inspect -- players
    npm run inspect -- status
    npm run inspect -- block "{\\"dimension\\":\\"minecraft:overworld\\",\\"position\\":{\\"x\\":0,\\"y\\":64,\\"z\\":0}}"
`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const toolArg = args[0];
const toolName = TOOL_ALIASES[toolArg] ?? (toolArg.startsWith("inspect.") ? toolArg : null);
if (!toolName) {
  console.error(`Unknown tool '${toolArg}'`);
  usage();
  process.exit(1);
}

let toolArgs = {};
if (args[1]) {
  try {
    toolArgs = JSON.parse(args[1]);
  } catch {
    console.error("Arguments must be valid JSON");
    process.exit(1);
  }
}

printBanner(`Inspect · ${toolName}`);

const { baseUrl, token } = ensureEnv();

const health = await api(baseUrl, "/v1/health").catch(() => null);
if (!health?.ok) {
  console.log(`  Controller unreachable at ${baseUrl}`);
  console.log("  Start it with:  npm run dev");
  process.exit(1);
}
if (!health.json.bdsConnected) {
  console.log("  No connected BDS session yet.");
  console.log("  Load the IntelaCraft pack on BDS, then retry.");
  console.log("  Check: npm run health");
  console.log("");
  process.exit(1);
}

const enqueue = await api(baseUrl, "/v1/actions", {
  method: "POST",
  token,
  body: {
    toolName,
    arguments: toolArgs,
    actor: "cli",
  },
});

if (!enqueue.ok) {
  console.log(`  Enqueue failed (${enqueue.status})`);
  console.log(JSON.stringify(enqueue.json, null, 2));
  process.exit(1);
}

console.log(`  Queued action ${enqueue.json.actionId}`);
console.log("  Waiting for BDS result...");

const actionId = enqueue.json.actionId;
const deadline = Date.now() + 20_000;

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
  const events = await api(baseUrl, "/v1/events", { token });
  if (!events.ok) continue;
  const match = (events.json.events ?? [])
    .map((e) => e.event)
    .reverse()
    .find((e) => e?.actionId === actionId);
  if (!match) continue;

  console.log(`  State   ${match.state}`);
  console.log(`  Message ${match.message}`);
  if (match.error) {
    console.log(`  Error   ${match.error.code}: ${match.error.message}`);
  }
  if (match.result !== undefined) {
    console.log("  Result");
    console.log(JSON.stringify(match.result, null, 2).replace(/^/gm, "  "));
  }
  console.log("");
  process.exit(match.state === "completed" ? 0 : 1);
}

console.log("  Timed out waiting for BDS (is the pack connected?)");
console.log("  Check: npm run health");
console.log("");
process.exit(1);
