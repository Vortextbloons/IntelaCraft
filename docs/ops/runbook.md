# IntelaCraft Operations Runbook

## Start / stop

```powershell
npm run setup
npm run build
npm run dev
```

Open the webview at `http://127.0.0.1:8787/` (after build). Enter the same bearer token as `INTELACRAFT_BDS_TOKEN`.

Health check: `npm run health` or `GET /v1/health`.

## AI Mode Selection

IntelaCraft has two AI modes independent from permission modes:

- **`ask`** (default) — Read-only. The agent inspects the world and answers questions but cannot plan or execute mutations. Use for exploration, auditing, or when you want zero mutation risk.
- **`agent`** — Full planning. The agent can inspect, plan builds, and propose mutations. Mutations still subject to permission mode and risk classification.

When creating a task, pass `"mode": "agent"` in the request body (defaults to `"ask"`). Use the mode selector in the webview to switch.

Switching from `ask` to `agent` mid-task is supported via the continue endpoint (`POST /v1/tasks/:id/stream`). The mode is validated at plan time — plans with mutations are rejected in `ask` mode.

## Deploy Bedrock packs

Configure `apps/bedrock-addon/.env` with `DEPLOY_PATH`, then `npm run deploy`. Restart BDS after pack changes. Ensure script networking and admin modules are enabled and variables/secrets match `.env`.

## Before large or destructive builds

Take a normal BDS world backup. IntelaCraft rollback capture is bounded and not a substitute for backups. Prefer strong confirmation for air fills and builds above 4,096 blocks.

## Emergency disable

From the webview **Emergency disable** control, or:

```powershell
# POST /v1/emergency-disable with Authorization: Bearer <token>
```

Clears only when explicitly re-enabled. The behavior pack also checks emergency state at batch boundaries.

## Activity history

Audit file: `INTELACRAFT_AUDIT_PATH` (default `./data/audit.jsonl`). Query via `GET /v1/activity`. Purge via `DELETE /v1/activity` (administrator action). Retention days: `INTELACRAFT_AUDIT_RETENTION_DAYS`.

## Admin commands

Configure `INTELACRAFT_ADMIN_COMMANDS` as JSON:

```json
{"time_day":{"command":"time set day","risk":"normal","label":"Set time to day"}}
```

Mirror the same map in BDS variable `intelacraft:admin_commands`. Only `commandId` values from this allowlist can run.

## Incident response

1. Enable emergency disable.
2. Cancel active builds (`control.cancel` / webview Cancel).
3. Inspect `/v1/activity` and the audit file for correlated `taskId` / `actionId` / `operationId`.
4. Restore from BDS backup if world state is wrong.
5. Rotate `INTELACRAFT_BDS_TOKEN` and BDS secret if compromise is suspected.

## CLI Commands Reference

| Command | Purpose |
|---------|---------|
| `npm run setup` | Install dependencies, build all packages, create `.env` if missing |
| `npm run build` | Build all packages in dependency order |
| `npm run dev` | Start controller (serves webview + API) |
| `npm run health` | Check controller / BDS connection status |
| `npm run inspect -- <tool>` | Queue a read-only tool for inspection |
| `npm run deploy` | Deploy behavior and resource packs to BDS |
| `npm run configure-bds` | Write BDS configuration files |
| `npm test` | Run protocol, pi-extension, and controller tests |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run load-smoke` | Run load test against the controller |

## PowerShell Launcher

`dev.ps1` wraps the npm commands above for convenience. Run from the repository root:

```powershell
.\dev.ps1 setup          # Install + build + create .env
.\dev.ps1                # Default: start dev server
.\dev.ps1 health         # Health check
.\dev.ps1 inspect <tool> # Queue a read tool
.\dev.ps1 deploy         # Deploy packs to BDS
.\dev.ps1 test           # Run test suite
.\dev.ps1 build          # Rebuild all packages
```

## Monitoring

### Health check endpoint

`GET /v1/health` returns controller status and BDS connectivity. Use `npm run health` for a CLI equivalent.

### Heartbeat monitoring

The controller emits SSE heartbeats. Loss of heartbeats indicates the controller has stopped or the connection dropped.

### Activity log queries

`GET /v1/activity` returns recent operations. Filter by `taskId`, `actionId`, or `operationId` to trace a specific action through the system.

### Audit log inspection

The audit file (`INTELACRAFT_AUDIT_PATH`, default `./data/audit.jsonl`) records every mutation with risk classification, actor, and approval hash. Inspect with `jq` or any JSONL reader for forensic analysis.

## Backup and Recovery

| Item | Default path | Notes |
|------|-------------|-------|
| Audit log | `./data/audit.jsonl` | JSONL, append-only; copy before `DELETE /v1/activity` |
| Activity store | `./data/activity.jsonl` | JSONL, current session activity |
| Provider profiles | `./data/providers.json` | API key references (keys are environment variables) |
| Pi session data | `./data/pi/` | Planning agent working state |
| BDS configuration | `apps/bedrock-addon/.env` | Environment variables and deploy settings |

Always take a BDS world backup before large or destructive builds. IntelaCraft rollback capture is bounded and not a substitute for full backups.
