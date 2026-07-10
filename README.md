# IntelaCraft

IntelaCraft is an AI-assisted control system for Minecraft Bedrock Dedicated Server. Phase 1 (Trusted Execution Foundation) is implemented: shared protocol, authenticated controller ↔ behavior-pack connection, read-only world inspection, health reporting, and audit logging.

See the [product and technical specification](docs/SPEC.md) and [Phase 1 decisions](docs/spec/decisions.md).

Phase 3 adds isolated Pi planning sessions, OpenAI-compatible provider discovery/testing, optional advisory Bedrock MCP access, structured plans, policy-validated proposed actions, and read-only verification plans. See [Phase 3 decisions](docs/spec/phase-3-decisions.md).

## Quick start

From the repo root:

```powershell
npm run setup
npm run dev
```

In another terminal:

```powershell
npm run health
npm run inspect -- players
```

Or use the PowerShell launcher:

```powershell
.\dev.ps1 setup
.\dev.ps1
.\dev.ps1 health
.\dev.ps1 inspect players
```

`npm run setup` installs deps, builds packages, and creates `.env` from `.env.example` if needed.

## Everyday commands

| Command | What it does |
|---------|----------------|
| `npm run setup` | Install + build + create `.env` |
| `npm run dev` | Start the controller (loads `.env`) |
| `npm run health` | Show controller / BDS connection status |
| `npm run inspect -- <tool>` | Queue a read tool and wait for the result |
| `npm run deploy` | Build + deploy Bedrock packs to `DEPLOY_PATH` |
| `npm test` | Run protocol + controller tests |
| `npm run build` | Build all packages |

Inspect tools: `players`, `status`, `time`, `weather`, `rules`, `block`, `region`.

```powershell
npm run inspect -- players
npm run inspect -- status
npm run inspect -- block '{\"dimension\":\"minecraft:overworld\",\"position\":{\"x\":0,\"y\":64,\"z\":0}}'
```

## Configure BDS

Enable script networking / admin modules for the IntelaCraft pack, then set:

| Kind | Name | Example |
|------|------|---------|
| Variable | `intelacraft:controller_url` | `http://127.0.0.1:8787` |
| Variable | `intelacraft:server_id` | `my-bds` |
| Secret | `intelacraft:bds_token` | same as `INTELACRAFT_BDS_TOKEN` in `.env` |

Examples: [apps/bedrock-addon/bds-config.example/](apps/bedrock-addon/bds-config.example/).

For pack deploy, create `apps/bedrock-addon/.env`:

```text
DEPLOY_PATH=<Minecraft data directory>
DOWNLOAD_PATH=<release output directory>
```

Then:

```powershell
npm run deploy
```

## Repository layout

```text
apps/bedrock-addon/       Behavior + resource packs
services/controller/      HTTP controller + audit log
packages/shared-protocol/ Shared message types / validators
scripts/                  setup / dev / health / inspect CLIs
docs/SPEC.md
```

## API surface (Phase 1)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/v1/health` | no | Controller + BDS heartbeat status |
| POST | `/v1/bds/handshake` | bearer | Protocol negotiate / session bind |
| POST | `/v1/bds/poll` | bearer | Dequeue one pending action |
| POST | `/v1/bds/events` | bearer | Report operation results |
| POST | `/v1/bds/heartbeat` | bearer | Connection health |
| POST | `/v1/actions` | bearer | Enqueue a validated read action |
| GET | `/v1/events` | bearer | Recent operation events |
