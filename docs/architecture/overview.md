# Architecture Overview

IntelaCraft is an AI-assisted control system for Minecraft Bedrock Dedicated Server (BDS). A user describes work in natural language, the AI agent inspects the world and proposes a plan, the user approves changes, and a behavior pack executes them safely on the server.

IntelaCraft operates in one of two **AI modes**:

- **Ask** (default) — The AI can inspect the world and answer questions, but never proposes mutations or verification steps. Plans are read-only and complete without user approval.
- **Agent** — The AI can inspect, propose mutations, and include verification steps. Mutations require user approval in the webview before the behavior pack executes them.

The mode is independent from the **permission mode** (which controls what the BDS addon allows after approval).

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        User's Browser                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   IntelaCraft Webview                         │  │
│  │         React SPA — chat, plans, approval, status             │  │
│  └─────────────────────────┬─────────────────────────────────────┘  │
└────────────────────────────┼────────────────────────────────────────┘
                             │ HTTP (localhost only)
                             v
┌────────────────────────────────────────────────────────────────────┐
│                      Controller (Node.js)                          │
│                                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Policy   │  │  Agent   │  │  Audit   │  │  Session Store   │  │
│  │  Engine   │  │ Runtime  │  │   Log    │  │  (queues, state) │  │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └────────┬─────────┘  │
│       │              │                               │             │
│       v              v                               v             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              HTTP Server (port 8787)                          │  │
│  └──────────┬──────────────────────────────┬────────────────────┘  │
└─────────────┼──────────────────────────────┼───────────────────────┘
              │                              │
              v                              v
┌─────────────────────┐        ┌─────────────────────────────────┐
│  Pi Agent Runtime   │        │   BDS Behavior Pack             │
│  (isolated config)  │        │   (runs inside Minecraft)       │
│                     │        │                                 │
│  ┌───────────────┐  │        │  ┌──────────┐  ┌──────────┐   │
│  │  Tool Catalog │  │        │  │  Net     │  │  Tools   │   │
│  │  (inspect,    │  │        │  │  Session │  │  (inspect│   │
│  │   fill, admin)│  │        │  │  (poll)  │  │  mutate) │   │
│  └───────────────┘  │        │  └──────────┘  └──────────┘   │
└─────────────────────┘        └─────────────────────────────────┘
              │
              v
┌──────────────────────────────────────┐
│  MCP (Optional, Advisory Only)       │
│  Bedrock Script API knowledge        │
└──────────────────────────────────────┘
```

## Component Architecture

### 1. `@intelacraft/controller` — services/controller/

The central HTTP server that bridges all components. Written in TypeScript on Node.js.

**Responsibilities:**
- HTTP API serving both the webview and the BDS behavior pack
- Bearer token authentication on all API routes
- Action queuing and idempotent delivery to the BDS addon
- Risk classification (`policy.ts:47`) and permission mode enforcement (`policy.ts:99`)
- AI mode enforcement (`src/agent/planning/planner.ts`) — rejects mutation and verification steps in Ask mode
- SHA-256 approval binding (`policy.ts:21`)
- Emergency disable gate (`store.ts:25`)
- Audit log append-only persistence (`audit.ts`)
- Activity history queries (`activity.ts`)
- SSE event streaming for real-time updates
- Static file serving for the webview SPA

**Key source files:**

| File | Role |
|------|------|
| `src/app.ts` | HTTP server creation (38 lines) |
| `src/routes/router.ts` | Central URL dispatcher with regex matching |
| `src/routes/tasks.ts` | Task CRUD + SSE streaming |
| `src/routes/bds.ts` | BDS protocol endpoints + action enqueue |
| `src/routes/settings.ts` | Settings CRUD + emergency disable |
| `src/routes/providers.ts` | Provider CRUD |
| `src/routes/health.ts` | Health check |
| `src/routes/events.ts` | Event list + SSE stream |
| `src/routes/activity-api.ts` | Activity query + purge |
| `src/routes/pi-sessions.ts` | Pi session management |
| `src/routes/mcp.ts` | MCP status |
| `src/routes/types.ts` | AppContext interface (dependency injection) |
| `src/http.ts` | JSON parsing, bearer auth, response helpers |
| `src/policy.ts` | Risk classification, mode enforcement, approval validation |
| `src/store.ts` | SessionStore (queues, idempotency), EventStore, SettingsStore |
| `src/agent/index.ts` | Public exports for agent module |
| `src/agent/types.ts` | AgentTask, AgentTaskState (12 states), AgentContext, PlanInput, CreateTaskInput |
| `src/agent/runtime.ts` | AgentRuntime facade class — thin delegation to pure functions |
| `src/agent/task-store.ts` | File-based task persistence with debounced writes |
| `src/agent/provider-store.ts` | Provider persistence, CRUD, model discovery |
| `src/agent/chat-history.ts` | 32-turn chat history with 4000-char truncation |
| `src/agent/sanitize.ts` | API key validation, stable JSON serialization |
| `src/agent/lifecycle/approve.ts` | Task approval with payload hashing |
| `src/agent/lifecycle/cancel.ts` | Task cancellation with queued action removal |
| `src/agent/lifecycle/operations.ts` | BDS event processing, state machine driver |
| `src/agent/lifecycle/reject.ts` | Task rejection |
| `src/agent/planning/planner.ts` | Task creation, planning with 2-retry validation |
| `src/agent/planning/replan.ts` | Replan, edit-replan, verify-after-mutations |
| `src/agent/inspection/bridge.ts` | Pi-to-BDS async tool bridge (16 call limit, 30s timeout) |
| `src/agent/inspection/materialize.ts` | Plan-to-action conversion, world context |
| `src/config.ts` | Environment variable parsing, region/admin-command config |
| `src/activity.ts` | Append-only activity record store |
| `src/audit.ts` | Structured audit log writer |

**Endpoints served:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/health` | GET | Connection status, sessions, agent state |
| `/v1/bds/handshake` | POST | Protocol version negotiation, session creation |
| `/v1/bds/poll` | POST | BDS addon polls for pending actions |
| `/v1/bds/events` | POST | BDS addon reports operation results |
| `/v1/bds/heartbeat` | POST | BDS addon sends health data |
| `/v1/actions` | POST | Enqueue a raw action (policy-gated) |
| `/v1/tasks` | POST/GET | Create or list agent tasks |
| `/v1/tasks/stream` | POST | Create task with SSE streaming |
| `/v1/tasks/:id` | GET/DELETE | Get or delete a specific task |
| `/v1/tasks/:id/approve` | POST | Approve a task's mutations |
| `/v1/tasks/:id/reject` | POST | Reject a task |
| `/v1/tasks/:id/cancel` | POST | Cancel a running task |
| `/v1/tasks/:id/replan` | POST | Edit-and-replan with user notes |
| `/v1/tasks/:id/stream` | POST | Continue a task with SSE streaming |
| `/v1/events` | GET | List recent operation events |
| `/v1/events/stream` | GET | SSE stream of live operation events |
| `/v1/activity` | GET/DELETE | Query or purge activity records |
| `/v1/settings` | GET/PATCH | Read or update permission mode, thinking level |
| `/v1/emergency-disable` | POST | Toggle emergency disable |
| `/v1/providers` | GET/POST | List or save provider profiles |
| `/v1/providers/active` | POST | Set active provider |
| `/v1/providers/:id/test` | POST | Test a provider connection |
| `/v1/providers/:id/models` | POST | Discover models for a provider |
| `/v1/mcp/status` | GET | MCP connection status |
| `/v1/pi/sessions` | GET/POST | List or create Pi sessions |

### 2. `@intelacraft/bedrock-addon` — apps/bedrock-addon/

A Minecraft Bedrock Script API behavior pack that runs inside the BDS process.

**Responsibilities:**
- HTTP client to the controller using `@minecraft/server-net`
- Periodic polling for actions (every 0.5 seconds / 10 ticks)
- Heartbeat reporting (every 3 polls / 6 seconds)
- Action revalidation and execution inside the Minecraft runtime
- Read-only world inspection (players, blocks, regions, entities, time, weather, etc.)
- Bounded block fill operations with batch processing
- Protected region enforcement at the world level
- Operation event emission back to the controller
- Idempotency tracking to prevent duplicate execution
- Emergency disable state (local to the addon)

**Key source files:**

| File | Role |
|------|------|
| `src/main.ts` | Entry point — loads config, starts session |
| `src/config.ts` | BDS environment variable parsing |
| `src/net/session.ts` | Poll loop, handshake, heartbeat, action dispatch |
| `src/net/client.ts` | HTTP client wrapper using `@minecraft/server-net` |
| `src/tools/inspect/` | Read-only world query implementations |
| `src/tools/mutate.ts` | Block fill, admin commands, control actions |
| `src/audit/notify.ts` | In-game operator notifications |

**Timing constants** (from `src/net/session.ts`):
- Poll interval: 10 ticks (0.5 seconds)
- Heartbeat: every 3rd poll (6 seconds)

### 3. `@intelacraft/webview` — apps/webview/

A React single-page application served by the controller as static files.

**Responsibilities:**
- AI chat interface with streaming token display
- Ask/Agent mode toggle in the composer area (persisted in localStorage)
- Plan review with action cards (targets, bounds, risk, approval)
- Approve/reject/cancel/replan controls
- BDS, controller, model, Pi, and MCP connection indicators
- Permission mode and safety-limit settings
- Provider profile and model selection with connection testing
- Activity history display
- Emergency disable toggle
- Minecraft-inspired visual design

**Trust level:** Untrusted client. Secrets are never returned to browser code after submission. Sensitive values are masked in all UI states.

### 4. `@intelacraft/shared-protocol` — packages/shared-protocol/

Wire protocol type definitions, validation functions, and factory utilities shared between the controller and the BDS addon.

**Responsibilities:**
- Protocol version constant (`1.0.0`)
- Message envelope types (handshake, poll, action_request, operation_event, heartbeat, error)
- Message factory functions (`createHandshake`, `createPoll`, `createOperationEvent`, etc.)
- Validation functions (`validateHandshake`, `validatePoll`, `validateActionRequest`, etc.)
- Tool argument schemas and validation
- Risk class, permission mode, operation state, dimension ID constants
- Build volume limits (`MAX_BUILD_VOLUME = 32^3`, `STRONG_BUILD_VOLUME = 4096`)
- Idempotency tracker
- `stableStringify` and `approvalPayload` for SHA-256 hash binding

**Key exports:**

```typescript
PROTOCOL_VERSION = "1.0.0"
RISK_CLASSES = ["read", "normal", "strong", "prohibited"]
PERMISSION_MODES = ["observe_only", "confirm_every_change", "allow_low_risk",
                    "builder_region", "trusted_administrator"]
AI_MODES = ["ask", "agent"]
OPERATION_STATES = ["running", "completed", "partially_completed", "failed", "cancelled"]
```

### 5. `@intelacraft/pi-extension` — packages/pi-extension/

Isolated AI planning agent runtime built on `@earendil-works/pi-coding-agent`.

**Responsibilities:**
- Create and manage isolated Pi sessions with their own config, auth, and storage
- Provider profile management (save, load, test, discover models)
- System prompt construction with IntelaCraft-specific tool catalog
- Mode-aware prompt injection — Ask mode restricts to read-only responses; Agent mode enables full planning
- Inspection tool registration (14 `inspect.*` tools)
- `submit_plan` tool that produces structured `AgentPlan` objects
- Plan normalization from messy model output (`normalizePlan`)
- Live inspection executor bridge (controller injects this per session)
- Tool result injection into Pi history (`injectPiToolResult`)
- Multi-turn chat memory with 16-turn window
- Thinking level support (off, minimal, low, medium, high, xhigh, max)
- Redaction of secrets from all outputs

**Plan structure:**

```typescript
interface AgentPlan {
  summary: string;           // Plain-language reply for chat
  inspection: AgentAction[]; // Read-only steps (auto-run, no approval)
  actions: AgentAction[];    // Mutations (require approval)
  verification: AgentAction[]; // Post-mutation checks
  notes: string[];
}
```

**Pi session mode:**

Each Pi session stores an `AiMode` (`"ask"` or `"agent"`) that controls the system prompt injected during planning. Ask mode tells the AI to produce only read-only responses with empty `actions` and `verification` arrays. Agent mode enables the full planning pipeline.

**Tool catalog** (defined in `PLANNER_TOOL_CATALOG`):

| Tool | Kind | Description |
|------|------|-------------|
| `inspect.server_status` | read | TPS, players, world basics |
| `inspect.players` | read | List online players |
| `inspect.player` | read | Detailed info for a single player |
| `inspect.block` | read | Block at one position |
| `inspect.region` | read | Sample blocks in a bounded region (max 32^3) |
| `inspect.voxel_snapshot` | read | Palette-indexed block snapshot for a region |
| `inspect.world_state` | read | Time, weather, game rules |
| `inspect.entities` | read | Entities in a dimension |
| `inspect.scoreboard` | read | Scoreboard objectives |
| `inspect.tags` | read | Tags on a target |
| `inspect.heightmap` | read | Terrain heights across a region |
| `inspect.surface` | read | Top solid block types |
| `inspect.build_collision` | read | Blocks in a proposed build volume |
| `inspect.find_empty_area` | read | Find empty build areas near origin |
| `world.fill_blocks` | write | Fill a bounded region with a block type |
| `world.place_blocks` | write | Place individual blocks at positions |
| `control.cancel` | write | Cancel a running action |
| `control.emergency_disable` | write | Global kill switch for all mutations |
| `admin.run_command` | write | Run an allowlisted admin command by ID |

### 6. `@intelacraft/mcp-connection` — packages/mcp-connection/

Optional advisory MCP (Model Context Protocol) client.

**Responsibilities:**
- Query an MCP server for Bedrock Script API documentation and guidance
- JSON-RPC 2.0 transport over HTTP
- Returns `null` when MCP is unconfigured or unreachable (never throws)
- Advisory only — cannot bypass direct-tool validation or approval

**Status reporting:**

```typescript
{
  configured: boolean;   // URL is set
  available: boolean;    // URL is set (same as configured)
  advisoryOnly: true;    // Always true
}
```

### 7. `@intelacraft/prompts` — packages/prompts/

Versioned prompt utilities used by the Pi extension.

**Responsibilities:**
- `wrapUntrusted(tag, value)` — wraps untrusted data in labeled XML tags
- `adminAllowlistSection(commandIds)` — generates the admin command allowlist section for system prompts
- `PROMPT_VERSION` constant for prompt versioning

### 8. `@intelacraft/construction` — packages/construction/

Semantic geometric build tools that translate high-level construction intents into deterministic block placements.

**Responsibilities:**
- `buildWall`, `buildFloor`, `buildPillar` — core geometry functions
- `generateSemantic(tool, args)` — unified dispatch for 9 semantic tools (`build.wall`, `build.floor`, `build.pillar`, `build.room`, `build.stairs`, `build.roof`, `build.doorway`, `build.window`, `build.path`)
- `previewPlacements(build, context)` — conflict/cost analysis without execution
- `validateBuildPlan(plan, limits)` — structural and geometric plan validation
- `materialTotals(blocks)` — material counting for resource estimates

## Trust Boundaries

```text
 ┌──────────────────────────────────────────────────────────────────┐
 │                        TRUST BOUNDARIES                         │
 ├──────────────────────────────────────────────────────────────────┤
 │                                                                  │
 │  ┌─────────────────────────────────────┐                        │
 │  │  TRUSTED CORE: Controller           │                        │
 │  │                                     │                        │
 │  │  - Authenticates all clients        │                        │
 │  │  - Applies policy enforcement       │                        │
 │  │  - Validates all schemas            │                        │
 │  │  - Records approvals with SHA-256   │                        │
 │  │  - Manages emergency disable        │                        │
 │  │  - Persists audit log               │                        │
 │  └───────────────┬─────────────────────┘                        │
 │                  │                                               │
 │    ┌─────────────┼──────────────┐                                │
 │    │             │              │                                 │
 │    v             v              v                                 │
 │  ┌──────────┐ ┌──────────┐ ┌──────────────┐                    │
 │  │ BDS Addon│ │ Webview  │ │  AI Agent    │                    │
 │  │(semi-    │ │(untrust- │ │  (untrusted) │                    │
 │  │ trusted) │ │  ed)     │ │              │                    │
 │  └──────────┘ └──────────┘ └──────┬───────┘                    │
 │                                    │                             │
 │                                    v                             │
 │                              ┌──────────┐                       │
 │                              │   MCP    │                       │
 │                              │(advisory │                       │
 │                              │  only)   │                       │
 │                              └──────────┘                       │
 └──────────────────────────────────────────────────────────────────┘
```

### Trust levels by component

| Component | Trust Level | Rationale |
|-----------|-------------|-----------|
| **Controller** | Trusted core | Authenticates clients, enforces policy, validates schemas, records approvals, manages emergency disable. The single source of truth for all security decisions. |
| **BDS Addon** | Semi-trusted | Runs inside the Minecraft process. Independently validates every operation against the protocol. Enforces protected regions, batch limits, and idempotency. Cannot be bypassed by the controller. |
| **Webview** | Untrusted client | Browser-based SPA. Never receives API keys or secrets after submission. Cannot make authorization decisions. All mutations require explicit user approval with SHA-256 binding. |
| **AI Agent** | Untrusted | Model output is untrusted input. Can only inspect the world through controlled tools. All mutations are blocked until the user approves in the webview. Plans are validated and risk-classified before display. |
| **MCP** | Advisory only | Provides documentation and guidance only. Cannot execute world changes. Output is treated as untrusted data wrapped in `<untrusted_mcp_advice>` tags. Never trusted for authorization. |

### Key security invariants

1. **AI prompt is never a security boundary.** Every operation is validated at both the controller and behavior-pack layers.
2. **Approval binds to the exact immutable payload.** SHA-256 hash of the displayed action is required for mutations. Modified, expired, or replayed requests are rejected.
3. **Protected regions are enforced at both layers.** Controller checks before enqueue; addon checks at execution.
4. **Emergency disable is a hard gate.** When active, no non-read mutations pass — even if the controller or agent requests them.
5. **Credentials never reach the webview or addon.** API keys and tokens stay server-side. The webview receives them only at submission time and never sees them again.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (all packages) |
| Runtime | Node.js (controller), Minecraft Bedrock Script API (addon) |
| Web framework | Raw `node:http` (no Express dependency) |
| Frontend | React (webview SPA) |
| AI runtime | `@earendil-works/pi-coding-agent` (isolated Pi sessions) |
| Package manager | npm workspaces |
| Build | TypeScript compiler (`tsc`) per package |
| Transport | HTTP + JSON (controller ↔ addon), SSE (controller ↔ webview) |
| Auth | Bearer token (controller ↔ addon), no auth (webview → controller) |

### Workspace structure

```text
intelacraft/                          # Root (npm workspace)
├── apps/
│   ├── bedrock-addon/                # @intelacraft/bedrock-addon
│   └── webview/                      # @intelacraft/webview
├── services/
│   ├── controller/                   # @intelacraft/controller
│   │   └── src/
│   │       ├── agent.ts              # Barrel re-export
│   │       ├── agent/                # Agent module (modular directory)
│   │       │   ├── types.ts          # AgentTask, AgentTaskState, AgentContext
│   │       │   ├── runtime.ts        # AgentRuntime facade class
│   │       │   ├── task-store.ts     # File-based task persistence
│   │       │   ├── provider-store.ts # Provider persistence, CRUD
│   │       │   ├── chat-history.ts   # 32-turn chat history
│   │       │   ├── sanitize.ts       # API key validation
│   │       │   ├── lifecycle/        # Task lifecycle operations
│   │       │   ├── planning/         # Task creation, replan
│   │       │   └── inspection/       # Pi-to-BDS tool bridge
│   │       ├── app.ts                # HTTP server creation
│   │       ├── routes/               # Route handlers (modular directory)
│   │       │   ├── router.ts         # Central URL dispatcher
│   │       │   ├── tasks.ts          # Task CRUD + SSE
│   │       │   ├── bds.ts            # BDS protocol endpoints
│   │       │   ├── settings.ts       # Settings CRUD
│   │       │   ├── providers.ts      # Provider CRUD
│   │       │   ├── health.ts         # Health check
│   │       │   ├── events.ts         # Event list + SSE
│   │       │   ├── activity-api.ts   # Activity query + purge
│   │       │   ├── pi-sessions.ts    # Pi session management
│   │       │   ├── mcp.ts            # MCP status
│   │       │   ├── builds.ts         # Build library CRUD, scene, render
│   │       │   └── types.ts          # AppContext interface
│   │       └── ...                   # Other source files
│   └── voxel-renderer/               # Go-based 3D voxel renderer (child process IPC)
├── packages/
│   ├── shared-protocol/              # @intelacraft/shared-protocol
│   ├── pi-extension/                 # @intelacraft/pi-extension
│   ├── mcp-connection/               # @intelacraft/mcp-connection
│   ├── construction/                 # @intelacraft/construction
│   └── prompts/                      # @intelacraft/prompts
└── docs/
    └── architecture/
        ├── overview.md               # This document
        └── data-flow.md              # Data flow documentation
```

### Build dependency order

```text
shared-protocol → prompts → construction → pi-extension → mcp-connection → controller → bedrock-addon → webview
```

Each package depends only on packages earlier in this chain.

## Deployment Topology

IntelaCraft is designed as a **localhost-only** system running on a single machine:

```text
┌──────────────────────────────────────────────────────┐
│                  Single Machine                      │
│                                                      │
│  ┌────────────┐     ┌────────────────────────────┐  │
│  │  BDS       │     │  Controller (port 8787)    │  │
│  │  (port     │────>│  Serves webview at /       │  │
│  │  19132)    │<────│  API at /v1/*              │  │
│  │            │     │  SSE at /v1/events/stream   │  │
│  └────────────┘     └────────────────────────────┘  │
│       │                     ▲                        │
│       │  localhost HTTP     │  localhost HTTP        │
│       └─────────────────────┘                        │
│                                                      │
│  ┌────────────────────────────┐                     │
│  │  Browser (localhost:8787)  │                     │
│  │  Webview SPA               │                     │
│  └────────────────────────────┘                     │
└──────────────────────────────────────────────────────┘
```

**Key deployment characteristics:**

- The controller binds to `localhost` only (no external network exposure)
- The webview is served as static files by the controller at the root path
- The BDS addon connects to the controller via `localhost` HTTP
- All communication is authenticated with a shared bearer token (`INTELACRAFT_BDS_TOKEN`)
- Configuration is via environment variables (`.env` file)
- Provider credentials are stored server-side in `data/providers.json`
- Audit logs are append-only JSONL files in `data/audit.jsonl`
- Pi session storage is in `data/pi/`

**Environment variables** (from `config.ts`):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `INTELACRAFT_BDS_TOKEN` | Yes | — | Bearer token for controller↔addon auth |
| `PORT` | No | `8787` | Controller listen port |
| `INTELACRAFT_AUDIT_PATH` | No | `./data/audit.jsonl` | Audit log path |
| `INTELACRAFT_AUDIT_RETENTION_DAYS` | No | `30` | Audit retention period |
| `INTELACRAFT_HEARTBEAT_STALE_MS` | No | `15000` | Heartbeat timeout |
| `INTELACRAFT_PERMISSION_MODE` | No | `confirm_every_change` | Default permission mode |
| `INTELACRAFT_PROTECTED_REGIONS` | No | `[]` | Protected region JSON |
| `INTELACRAFT_BUILDER_REGIONS` | No | `[]` | Builder region JSON |
| `INTELACRAFT_PROVIDER_BASE_URL` | No | — | Default AI provider URL |
| `INTELACRAFT_PROVIDER_API_KEY` | No | — | Default AI provider key |
| `INTELACRAFT_PROVIDER_MODEL` | No | — | Default AI model |
| `INTELACRAFT_PI_STORAGE_PATH` | No | `./data/pi` | Pi session storage |
| `INTELACRAFT_PROVIDERS_PATH` | No | `./data/providers.json` | Provider profiles |
| `INTELACRAFT_MCP_URL` | No | — | MCP server URL |
| `INTELACRAFT_MCP_TOKEN` | No | — | MCP auth token |
| `INTELACRAFT_ADMIN_COMMANDS` | No | `{}` | Admin command allowlist |
| `INTELACRAFT_WEBVIEW_DIST` | No | `apps/webview/dist` | Webview build path |
