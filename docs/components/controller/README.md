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
| `src/app.ts` | ~38 | HTTP server creation with error handling |
| `src/http.ts` | ~62 | HTTP server utilities, request/response helpers |
| `src/config.ts` | ~108 | Configuration loading and defaults |
| `src/env.ts` | ~39 | Environment variable parsing |
| `src/store.ts` | ~209 | SessionStore, EventStore, SettingsStore |
| `src/policy.ts` | ~121 | Risk classification and approval policy |
| `src/audit.ts` | ~31 | Audit log (integrates with ActivityStore) |
| `src/activity.ts` | ~112 | Activity store with query/prune, async write queue |
| `src/static.ts` | ~41 | Serves the React webview from `apps/webview/dist/` |
| `src/agent/` | — | AI agent runtime (modular, see below) |
| `src/routes/` | — | HTTP route handlers (modular, see below) |
| `src/*.test.ts` | — | Unit tests |

### `src/routes/` Directory

| File | Lines | Purpose |
|------|-------|---------|
| `routes/types.ts` | ~15 | `AppContext` interface |
| `routes/router.ts` | ~151 | Central URL dispatcher, auth, static serving |
| `routes/tasks.ts` | ~254 | Task CRUD, approve/reject/cancel/replan, SSE streaming |
| `routes/bds.ts` | ~338 | Handshake, poll, events, heartbeat, action enqueue (policy enforcement) |
| `routes/settings.ts` | ~70 | Settings CRUD, emergency disable |
| `routes/providers.ts` | ~46 | Provider CRUD, test, model discovery |
| `routes/health.ts` | ~40 | Health check |
| `routes/events.ts` | ~34 | Event listing, SSE stream (15s keepalive) |
| `routes/activity-api.ts` | ~21 | Activity query and purge |
| `routes/pi-sessions.ts` | ~18 | Pi session list/create |
| `routes/mcp.ts` | ~8 | MCP connection status |

### `src/agent/` Directory

| File | Lines | Purpose |
|------|-------|---------|
| `agent/index.ts` | ~2 | Barrel exports: `AgentRuntime`, `AgentTask`, `AgentTaskState` |
| `agent/types.ts` | ~124 | `AgentTaskState`, `AgentTask`, `AgentContext`, `InspectionWaiter`, `PlanInput`, `CreateTaskInput` |
| `agent/runtime.ts` | ~303 | `AgentRuntime` facade class implementing `AgentContext` |
| `agent/task-store.ts` | ~66 | Task persistence (debounced 50ms), CRUD, `publicTask` |
| `agent/provider-store.ts` | ~115 | Provider persistence, CRUD, model discovery, `needProvider` |
| `agent/chat-history.ts` | ~39 | Chat history resolution (16 turns), append (32-turn cap, 4k chars/turn) |
| `agent/sanitize.ts` | ~23 | Deterministic JSON, API key sanitization |
| `agent/lifecycle/approve.ts` | ~105 | Task approval with payload hashing, auto-enqueue reads |
| `agent/lifecycle/cancel.ts` | ~50 | Task cancellation, removes queued actions |
| `agent/lifecycle/operations.ts` | ~153 | Operation event processing, per-task promise chain, state machine driver |
| `agent/lifecycle/reject.ts` | ~29 | Task rejection |
| `agent/planning/planner.ts` | ~377 | `createTaskInternal`, `continueTask`, validation retry loop, pending reads |
| `agent/planning/replan.ts` | ~221 | Agent verification, inspect replan, edit-and-replan |
| `agent/inspection/bridge.ts` | ~121 | Inspection executor (rate-limited, cached, 30s timeout) |
| `agent/inspection/materialize.ts` | ~215 | World context, action materialization, plan application, collision updates |

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
