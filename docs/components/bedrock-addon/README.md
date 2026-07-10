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
│   │   │   └── index.ts     10 read-only inspection tools
│   │   └── mutate.ts        4 mutation tools (fill, cancel, emergency, admin command)
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

12 defense layers protect the server from harmful mutations:

| # | Layer | Description |
|---|-------|-------------|
| 1 | **Config validation** | Addon refuses to start if required variables/secrets are missing |
| 2 | **Protected regions** | Configurable AABB regions blocked from fill operations |
| 3 | **Volume limits** | MAX_BUILD_VOLUME (32768) and MAX_REGION_VOLUME (32768) hard caps |
| 4 | **Emergency disable** | Global kill switch (`control.emergency_disable`) halts all mutations |
| 5 | **Expiry** | Actions with expired `expiresAt` are rejected |
| 6 | **Idempotency** | Duplicate `idempotencyKey` values are detected and rejected |
| 7 | **Allowlist** | `admin.run_command` only executes pre-approved command IDs |
| 8 | **Command mismatch** | Optional command string must match the allowlist entry |
| 9 | **Cancellation** | `control.cancel` adds action ID to a cancelled set; generators check per-iteration |
| 10 | **Rollback capture** | Fill stores original blocks before modification (up to 8192) |
| 11 | **Auth invalidation** | 401 responses force re-handshake, clearing stale sessions |
| 12 | **Busy guard** | Concurrent tick invocations are skipped via a `busy` flag |

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
