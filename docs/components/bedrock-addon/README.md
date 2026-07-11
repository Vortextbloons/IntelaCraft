# Bedrock Addon

The in-game execution agent for IntelaCraft. It runs inside Minecraft Bedrock Dedicated Server (BDS) as a Script API behavior pack, connects to the controller over HTTP, polls for actions, inspects world state, and executes mutations under strict safety constraints.

## File Structure

```
apps/bedrock-addon/
├── src/
│   ├── main.ts              Entry point: config load, session creation
│   ├── config.ts            BDS variable/secret loading
│   ├── net/
│   │   ├── client.ts        HTTP client (ControllerClient)
│   │   └── session.ts       Session lifecycle (handshake, poll, heartbeat, action dispatch)
│   ├── tools/
│   │   ├── inspect/
│   │   │   ├── index.ts     Dispatcher — routes to sub-modules by tool name
│   │   │   ├── helpers.ts   Shared types (ToolResult) and utilities
│   │   │   ├── server.ts    Server/player queries (server_status, players, player)
│   │   │   ├── world.ts     Block/entity/world-state queries (block, region, world_state, entities)
│   │   │   ├── terrain.ts   Spatial/terrain analysis (heightmap, surface, build_collision, find_empty_area)
│   │   │   └── meta.ts      Server metadata (scoreboard, tags)
│   │   └── mutate.ts        5 mutation tools (fill, place, cancel, emergency, admin command)
│   └── audit/
│       └── notify.ts        Operator notification (in-game + console)
├── behavior_pack/           BDS behavior pack (manifest, scripts/main.js)
├── resource_pack/           BDS resource pack
├── bds-config.example/      Example BDS config files
│   ├── variables.json
│   ├── secrets.json
│   └── permissions.json
├── scripts/
│   ├── build.js             esbuild bundler
│   ├── deploy.js            Dev/prod deployment
│   └── bundle.js            Interactive .mcaddon packager
└── package.json
```

## Quick Links

| Topic | File |
|-------|------|
| Session lifecycle | [session.md](./session.md) |
| Inspection tools | [inspection-tools.md](./inspection-tools.md) |
| Mutation tools | [mutation-tools.md](./mutation-tools.md) |
| Build and deploy | [build-deploy.md](./build-deploy.md) |

## Key Minecraft Script API Modules

| Module | Purpose |
|--------|---------|
| `@minecraft/server` | World, dimension, block, entity, player, game rules, scoreboard, ticks |
| `@minecraft/server-net` | HTTP requests to controller (`http.request`) |
| `@minecraft/server-admin` | BDS secrets and variables (`secrets.get`, `variables.get`) |

## Safety Overview

13 defense layers protect the server from harmful mutations:

| # | Layer | Description |
|---|-------|-------------|
| 1 | **Config validation** | Addon refuses to start if required variables/secrets are missing |
| 2 | **Protected regions** | Configurable AABB regions blocked from fill/placement operations |
| 3 | **Volume limits** | MAX_BUILD_VOLUME (32768) and MAX_REGION_VOLUME (32768) hard caps |
| 4 | **Block count limit** | MAX_PLACE_BLOCKS (8192) for detailed placements |
| 5 | **Emergency disable** | Global kill switch (`control.emergency_disable`) halts all mutations |
| 6 | **Expiry** | Actions with expired `expiresAt` are rejected |
| 7 | **Idempotency** | Duplicate `idempotencyKey` values are detected and rejected |
| 8 | **Allowlist** | `admin.run_command` only executes pre-approved command IDs |
| 9 | **Command mismatch** | Optional command string must match the allowlist entry |
| 10 | **Cancellation** | `control.cancel` adds action ID to a cancelled set; generators check per-iteration |
| 11 | **Rollback capture** | Fill/placement stores original blocks before modification (up to 8192) |
| 12 | **Auth invalidation** | 401/404 responses force re-handshake with backoff |
| 13 | **Busy guard** | Concurrent tick invocations are skipped via a `busy` flag |

## BDS Configuration

The addon reads configuration from BDS `config/default/` variables and secrets:

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `intelacraft:controller_url` | variable | Yes | Controller HTTP base URL (e.g. `http://127.0.0.1:8787`) |
| `intelacraft:bds_token` | secret | Yes | Full `Authorization` header value (e.g. `Bearer <token>`) |
| `intelacraft:server_id` | variable | No | Server identifier (defaults to `bds-default`) |
| `intelacraft:protected_regions` | variable | No | JSON array of dimension+region AABBs to block fills |
| `intelacraft:admin_commands` | variable | No | JSON object mapping command IDs to allowed commands |

See `bds-config.example/` for sample files.
