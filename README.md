# IntelaCraft

IntelaCraft is an AI-assisted control system for Minecraft Bedrock Dedicated Server. Phases 1–4 are implemented: trusted execution, safe mutations, agent/model integration, and a polished localhost webview with activity history, pragmatic admin tools, and hardening docs/tests.

See the [product and technical specification](spec/SPEC.md), [Phase 4 decisions](spec/start-spec/phase-4-decisions.md), [operations runbook](docs/ops/runbook.md), and [security review](docs/ops/security-review.md).

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
| `npm run deploy` | Deploy packs; if `BDS_PATH` is set, also configure BDS |
| `npm run configure-bds` | Write BDS variables/secrets/permissions + deploy packs |
| `npm test` | Run protocol + controller tests |
| `npm run load-smoke` | Concurrent poll/enqueue smoke (controller must be running) |

Inspect tools: `players`, `status`, `time`, `weather`, `rules`, `block`, `region`, `entities`, `scoreboard`, `tags`.

## Configure BDS

Set `BDS_PATH` in the repo `.env` to your Bedrock Dedicated Server folder (the one with `bedrock_server.exe`), then:

```powershell
npm run configure-bds
# or
npm run deploy
```

That merges IntelaCraft into `config/default/variables.json`, `secrets.json`, and `permissions.json` (without wiping other keys), deploys packs to `development_*_packs`, and enables them on worlds.

| Kind | Name | Example |
|------|------|---------|
| Variable | `intelacraft:controller_url` | `http://127.0.0.1:8787` |
| Variable | `intelacraft:server_id` | `my-bds` |
| Variable | `intelacraft:admin_commands` | same JSON as `INTELACRAFT_ADMIN_COMMANDS` |
| Variable | `intelacraft:protected_regions` | optional JSON regions |
| Secret | `intelacraft:bds_token` | `Bearer` + same value as `INTELACRAFT_BDS_TOKEN` (full Authorization header; required because scripts cannot concatenate SecretString) |

Manual examples: [apps/bedrock-addon/bds-config.example/](apps/bedrock-addon/bds-config.example/).

For client `com.mojang` pack-only deploy (no BDS config), omit `BDS_PATH` and set `DEPLOY_PATH` in `apps/bedrock-addon/.env` instead.
## Repository layout

```text
apps/bedrock-addon/       Behavior + resource packs
apps/webview/             React control panel (served by controller)
services/controller/      HTTP controller + audit + activity API
packages/shared-protocol/ Shared message types / validators
packages/pi-extension/    Isolated Pi planning
packages/mcp-connection/  Optional advisory MCP client
packages/prompts/         Versioned agent prompts
spec/SPEC.md              Full product and technical specification
spec/start-spec/          Split spec files (architecture, protocol, decisions)
docs/                     Documentation (architecture, guides, reference, ops)
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
| POST | `/v1/tasks/:id/replan` | bearer | Edit and replan |
| DELETE | `/v1/tasks/:id` | bearer | Delete task |

## Documentation

### Architecture
| Document | Description |
|----------|-------------|
| [System Architecture](docs/architecture/overview.md) | Components, trust boundaries, deployment topology |
| [Data Flow](docs/architecture/data-flow.md) | Message flow, protocols, sequence diagrams |

### Components
| Document | Description |
|----------|-------------|
| [Bedrock Addon](docs/components/bedrock-addon/README.md) | Behavior pack overview, safety mechanisms |
| [Session Lifecycle](docs/components/bedrock-addon/session.md) | Handshake, poll loop, heartbeat, reconnection |
| [Inspection Tools](docs/components/bedrock-addon/inspection-tools.md) | All 10 read-only world query tools |
| [Mutation Tools](docs/components/bedrock-addon/mutation-tools.md) | Fill blocks, control, admin commands |
| [Build & Deploy](docs/components/bedrock-addon/build-deploy.md) | esbuild, dev/prod deployment, BDS config |
| [Webview](docs/components/webview/README.md) | React control panel overview |
| [Webview Components](docs/components/webview/components.md) | All 7 React components |
| [Webview Data Flow](docs/components/webview/data-flow.md) | REST polling, SSE, persistence |
| [Controller](docs/components/controller/README.md) | HTTP server overview |
| [Controller Stores](docs/components/controller/stores.md) | Session, event, settings, activity stores |
| [Controller Policy](docs/components/controller/policy.md) | Risk classification, approval, permissions |
| [Agent Runtime](docs/components/controller/agent-runtime.md) | Task lifecycle, planning, inspection-replan |
| [Packages](docs/components/packages/README.md) | Package ecosystem overview |
| [Shared Protocol](docs/components/packages/shared-protocol.md) | Wire protocol types, validation, helpers |
| [Pi Extension](docs/components/packages/pi-extension.md) | AI planning agent runtime |
| [Prompts](docs/components/packages/prompts.md) | Prompt utilities |
| [MCP Connection](docs/components/packages/mcp-connection.md) | Advisory MCP client |

### Reference
| Document | Description |
|----------|-------------|
| [API Reference](docs/reference/api.md) | Complete HTTP API documentation |
| [Configuration](docs/reference/configuration.md) | Environment variables reference |
| [Protocol](docs/reference/protocol.md) | Shared protocol message types and validation |

### Guides
| Document | Description |
|----------|-------------|
| [Development Guide](docs/guides/development.md) | Developer setup and conventions |
| [Testing Guide](docs/guides/testing.md) | Testing approach and writing tests |
| [Deployment Guide](docs/guides/deployment.md) | Production deployment instructions |
| [Provider Setup](docs/guides/provider-setup.md) | Configuring AI providers |

### Operations
| Document | Description |
|----------|-------------|
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |
| [Runbook](docs/ops/runbook.md) | Operations runbook |
| [Security Review](docs/ops/security-review.md) | Security analysis and trust model |
