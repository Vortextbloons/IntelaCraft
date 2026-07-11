# Controller Service

Central HTTP server for IntelaCraft. Bridges the BDS (Bedrock Dedicated Server), the React webview, and the AI agent runtime.

## Tech Stack

- **Runtime**: Node.js with raw `node:http` (no Express)
- **Language**: TypeScript, ES modules
- **Port**: `127.0.0.1:8787` (configurable via `INTELACRAFT_PORT`)

## File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | — | Entry point, boots the server |
| `src/app.ts` | ~833 | Route definitions (all handlers) |
| `src/http.ts` | ~62 | HTTP server utilities, request/response helpers |
| `src/config.ts` | ~108 | Configuration loading and defaults |
| `src/env.ts` | ~39 | Environment variable parsing |
| `src/store.ts` | ~166 | SessionStore, EventStore, SettingsStore |
| `src/policy.ts` | ~121 | Risk classification and approval policy |
| `src/audit.ts` | ~22 | Audit log (JSONL append) |
| `src/activity.ts` | ~112 | Activity store with query/prune |
| `src/agent.ts` | ~1287 | AI agent runtime (task lifecycle) |
| `src/static.ts` | ~41 | Serves the React webview from `apps/webview/dist/` |
| `src/*.test.ts` | — | Unit tests |

## API Surface

All endpoints use the `/v1/` prefix (not `/api/`). Bearer token authentication is required on every `/v1/*` route **except** `/v1/health`.

### Authentication

```
Authorization: Bearer <INTELACRAFT_BDS_TOKEN>
```

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/health` | Server health check (no auth) |
| POST | `/v1/bds/handshake` | Register/update a BDS session |
| POST | `/v1/bds/poll` | BDS polls for pending actions |
| POST | `/v1/bds/events` | BDS reports operation results |
| POST | `/v1/bds/heartbeat` | Periodic session heartbeat |
| POST | `/v1/actions` | Enqueue a raw action (policy-gated) |
| GET | `/v1/events` | List recent operation events |
| GET | `/v1/events/stream` | SSE stream of operation events |
| GET | `/v1/activity` | Query activity records |
| DELETE | `/v1/activity` | Purge activity records |
| GET | `/v1/settings` | Get runtime settings |
| PATCH | `/v1/settings` | Update permission mode, thinking level |
| POST | `/v1/emergency-disable` | Toggle emergency disable |
| GET | `/v1/providers` | List AI providers |
| POST | `/v1/providers` | Add/update a provider |
| POST | `/v1/providers/active` | Set active provider |
| POST | `/v1/providers/:id/test` | Test provider connectivity |
| POST | `/v1/providers/:id/models` | Discover available models |
| GET | `/v1/mcp/status` | MCP connection status |
| GET/POST | `/v1/pi/sessions` | List or create Pi sessions |
| POST | `/v1/tasks` | Create a new agent task |
| POST | `/v1/tasks/stream` | Create task with SSE streaming |
| GET | `/v1/tasks` | List all tasks |
| GET | `/v1/tasks/:id` | Get task details + transcript |
| DELETE | `/v1/tasks/:id` | Delete a task |
| POST | `/v1/tasks/:id/approve` | Approve task mutations |
| POST | `/v1/tasks/:id/reject` | Reject a task plan |
| POST | `/v1/tasks/:id/cancel` | Cancel a running task |
| POST | `/v1/tasks/:id/replan` | Edit-and-replan with user notes |
| POST | `/v1/tasks/:id/stream` | Continue task with SSE streaming |

## Sub-Documents

- [Data Stores](stores.md) — SessionStore, EventStore, SettingsStore, ActivityStore, AuditLog
- [Policy](policy.md) — Risk classification, approval requirements, protected regions
- [Agent Runtime](agent-runtime.md) — Task lifecycle, planning, inspection, approval flow

## Serving the Webview

The controller serves the compiled React app from `apps/webview/dist/` at the root path `/`. Static file serving is handled by `src/static.ts`.
