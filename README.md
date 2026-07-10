# IntelaCraft

IntelaCraft is an AI-assisted control system for Minecraft Bedrock Dedicated Server. Phases 1–4 are implemented: trusted execution, safe mutations, agent/model integration, and a polished localhost webview with activity history, pragmatic admin tools, and hardening docs/tests.

See the [product and technical specification](docs/SPEC.md), [Phase 4 decisions](docs/spec/phase-4-decisions.md), [operations runbook](docs/ops/runbook.md), and [security review](docs/ops/security-review.md).

## Quick start

From the repo root:

```powershell
npm run setup
npm run build
npm run dev
```

Open the webview at `http://127.0.0.1:8787/` and enter the same bearer token as `INTELACRAFT_BDS_TOKEN`.

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
| `npm run build` | Build protocol, controller, packs, and webview |
| `npm run dev` | Start the controller (serves webview + API) |
| `npm run health` | Show controller / BDS connection status |
| `npm run inspect -- <tool>` | Queue a read tool and wait for the result |
| `npm run deploy` | Build + deploy Bedrock packs to `DEPLOY_PATH` |
| `npm test` | Run protocol + controller (+ e2e) tests |
| `npm run load-smoke` | Concurrent poll/enqueue smoke (controller must be running) |

Inspect tools: `players`, `status`, `time`, `weather`, `rules`, `block`, `region`, `entities`, `scoreboard`, `tags`.

## Configure BDS

Enable script networking / admin modules for the IntelaCraft pack, then set:

| Kind | Name | Example |
|------|------|---------|
| Variable | `intelacraft:controller_url` | `http://127.0.0.1:8787` |
| Variable | `intelacraft:server_id` | `my-bds` |
| Variable | `intelacraft:admin_commands` | same JSON as `INTELACRAFT_ADMIN_COMMANDS` |
| Variable | `intelacraft:protected_regions` | optional JSON regions |
| Secret | `intelacraft:bds_token` | same as `INTELACRAFT_BDS_TOKEN` in `.env` |

Examples: [apps/bedrock-addon/bds-config.example/](apps/bedrock-addon/bds-config.example/).

## Repository layout

```text
apps/bedrock-addon/       Behavior + resource packs
apps/webview/             React control panel (served by controller)
services/controller/      HTTP controller + audit + activity API
packages/shared-protocol/ Shared message types / validators
packages/pi-extension/    Isolated Pi planning
packages/mcp-connection/  Optional advisory MCP client
docs/SPEC.md
docs/ops/                 Runbook + security review
```

## API surface (Phase 4)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | no | Webview static UI |
| GET | `/v1/health` | no | Controller + BDS + agent summary |
| POST | `/v1/bds/handshake` | bearer | Protocol negotiate / session bind |
| POST | `/v1/bds/poll` | bearer | Dequeue one pending action |
| POST | `/v1/bds/events` | bearer | Report operation results |
| POST | `/v1/bds/heartbeat` | bearer | Connection health |
| POST | `/v1/actions` | bearer | Enqueue a validated action |
| GET | `/v1/events` | bearer | Recent operation events |
| GET | `/v1/events/stream` | bearer | SSE operation progress |
| GET | `/v1/activity` | bearer | Searchable activity history |
| DELETE | `/v1/activity` | bearer | Purge activity history |
| GET/PATCH | `/v1/settings` | bearer | Permission mode + admin command labels |
| POST | `/v1/emergency-disable` | bearer | Toggle emergency disable |
| GET/POST | `/v1/providers` | bearer | Provider profiles |
| POST | `/v1/providers/:id/test` | bearer | Test provider |
| POST | `/v1/providers/:id/models` | bearer | Discover models |
| GET | `/v1/mcp/status` | bearer | MCP availability |
| POST/GET | `/v1/pi/sessions` | bearer | Isolated Pi sessions |
| POST/GET | `/v1/tasks` | bearer | Planning tasks |
| POST | `/v1/tasks/:id/approve` | bearer | Approve + enqueue proposed actions |
| POST | `/v1/tasks/:id/reject` | bearer | Reject plan |
| POST | `/v1/tasks/:id/cancel` | bearer | Cancel in-flight task |
