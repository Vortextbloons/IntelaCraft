# Data Flow

This document describes the message flows, protocol details, and timing for IntelaCraft's communication paths.

## Primary Workflow

The complete flow from a user's natural-language request to world mutation. The flow varies by **AI mode**:

- **Ask mode** (default): Steps 6–7 run (inspection), then the AI produces a read-only plan. No approval or execution occurs — the plan completes immediately as a chat response.
- **Agent mode**: All 17 steps execute. Mutations in the plan require user approval before the BDS addon executes them.

The diagram below shows the full Agent mode flow:

```text
 ┌─────────┐    ┌───────────┐    ┌─────────────────────┐    ┌──────────┐    ┌─────────┐
 │  User   │    │ Webview   │    │ Controller          │    │ Pi Agent │    │   BDS   │
 │(browser)│    │  (React)  │    │  (Node.js)          │    │ (runtime)│    │ (addon) │
 └────┬────┘    └─────┬─────┘    └─────┬───────────────┘    └────┬─────┘    └────┬────┘
      │               │                │                  │               │
      │ 1. Type       │                │                  │               │
      │ "Fill 10x10   │                │                  │               │
      │  with stone"  │                │                  │               │
      │──────────────>│                │                  │               │
      │               │                │                  │               │
      │               │ 2. POST        │                  │               │
      │               │ /v1/tasks/     │                  │               │
      │               │ stream         │                  │               │
      │               │───────────────>│                  │               │
      │               │                │                  │               │
      │               │                │ 3. Query MCP     │               │
      │               │                │ (advisory)       │               │
      │               │                │─────────────────>│               │
      │               │                │                  │               │
      │               │                │ 4. MCP advice    │               │
      │               │                │<─────────────────│               │
      │               │                │                  │               │
      │               │                │ 5. Send user     │               │
      │               │                │ request + world  │               │
      │               │                │ context to Pi    │               │
      │               │                │─────────────────>│               │
      │               │                │                  │               │
      │               │                │                  │ 6. AI calls   │
      │               │                │   inspect.tools  │ inspect.tool  │
      │               │                │<─────────────────│──────────────>│
      │               │                │                  │               │
      │               │                │                  │ 7. BDS returns│
      │               │                │   inspect.result │ world state   │
      │               │                │─────────────────>│<──────────────│
      │               │                │                  │               │
      │               │  SSE: delta    │ 8. AI calls      │               │
      │               │ (streaming)   │ submit_plan      │               │
      │               │<───────────────│<─────────────────│               │
      │               │                │                  │               │
      │<──────────────│                │                  │               │
      │ 9. See plan   │                │                  │               │
      │               │                │                  │               │
      │ 10. Approve   │                │                  │               │
      │──────────────>│                │                  │               │
      │               │                │                  │               │
      │               │ 11. POST       │                  │               │
      │               │ /v1/tasks/     │                  │               │
      │               │ {id}/approve   │                  │               │
      │               │───────────────>│                  │               │
      │               │                │                  │               │
      │               │                │ 12. Controller   │               │
      │               │                │ validates policy,│               │
      │               │                │ enqueues action  │               │
      │               │                │──────────────────┼──────────────>│
      │               │                │                  │               │
      │               │                │                  │ 13. BDS polls │
      │               │                │<─────────────────┼──────────────<│
      │               │                │                  │               │
      │               │                │ 14. Action returned              │
      │               │                │──────────────────┼──────────────>│
      │               │                │                  │               │
      │               │                │                  │ 15. BDS       │
      │               │                │                  │ executes      │
      │               │                │                  │ (batches)     │
      │               │                │                  │               │
      │               │                │ 16. POST /v1/bds/events          │
      │               │                │<─────────────────┼──────────────<│
      │               │                │                  │               │
      │               │ SSE: operation │                  │               │
      │               │ event         │                  │               │
      │               │<───────────────│                  │               │
      │<──────────────│                │                  │               │
      │ 17. See       │                │                  │               │
      │ progress/results              │                  │               │
```

### Step-by-step breakdown

1. **User types request** in the webview chat input (natural language)
2. **Webview sends SSE request** to `POST /v1/tasks/stream` with `{ request, piSessionId, bdsSessionId, mode }` — mode is `"ask"` or `"agent"` (persisted in the webview's localStorage)
3. **Controller queries MCP** for advisory Bedrock API guidance (optional, 15s timeout) — handled in `src/routes/tasks.ts`
4. **MCP returns advice** (or null if unconfigured/unreachable)
5. **Controller sends prompt** to Pi agent with user request, world context, MCP advice, chat history, and a **mode-specific reminder** (handled in `src/agent/planning/planner.ts`):
   - Ask: *"answer or inspect read-only state only. actions and verification must both be empty."*
   - Agent: *"use live inspect_* tools when needed, then call submit_plan."*
6. **AI calls inspection tools** — Pi invokes `inspect.*` tools which are bridged to the BDS addon via the controller's session store queue
7. **BDS returns world state** — addon executes the read-only tool and emits an operation event
8. **AI produces plan** via `submit_plan` tool call — controller streams deltas to the webview via SSE
9. **User sees the plan** with action cards showing targets, bounds, risk, and approval requirements
10. **User approves** the plan in the webview (Agent mode only — Ask mode plans have no mutations)
11. **Webview sends approval** to `POST /v1/tasks/:id/approve`
12. **Controller validates and enqueues** — policy check, SHA-256 approval binding (`src/agent/lifecycle/approve.ts`), emergency disable gate, then queues the action for BDS pickup (`src/routes/bds.ts`)
13. **BDS polls** `POST /v1/bds/poll` every 0.5 seconds
14. **Controller returns action** from the session queue (or null if empty)
15. **BDS executes** the action in configurable batch sizes (default 512 blocks/tick)
16. **BDS reports results** via `POST /v1/bds/events` with operation state
17. **Webview shows progress** via SSE event stream subscription

## Message Protocol

All messages between the controller and BDS addon use HTTP POST with JSON bodies. Every message includes a standard envelope:

```typescript
interface MessageEnvelope {
  protocolVersion: string;   // "1.0.0"
  messageType: MessageType;
  requestId: string;         // Unique per-message ID
  sessionId: string;         // Assigned during handshake
  timestamp: string;         // ISO 8601
}
```

### Handshake

**Direction:** BDS Addon → Controller

```text
POST /v1/bds/handshake
Authorization: Bearer <INTELACRAFT_BDS_TOKEN>

{
  "protocolVersion": "1.0.0",
  "messageType": "handshake",
  "requestId": "req_abc123",
  "sessionId": "pending",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "serverId": "my-bds-server",
  "clientProtocolVersion": "1.0.0",
  "capabilities": ["inspect.read"]
}
```

**Response:**

```text
HTTP/1.1 200 OK

{
  "protocolVersion": "1.0.0",
  "messageType": "handshake_ack",
  "requestId": "req_abc123",
  "sessionId": "session_xyz789",
  "timestamp": "2025-01-01T00:00:00.100Z",
  "acceptedProtocolVersion": "1.0.0",
  "serverId": "my-bds-server",
  "ok": true
}
```

**Controller behavior:**
- Validates protocol compatibility via `isProtocolCompatible()`
- Creates a new session in `SessionStore` with a generated `sessionId`
- Logs the handshake to the audit trail
- Returns `400` if protocol is incompatible

### Poll

**Direction:** BDS Addon → Controller (every 0.5 seconds)

```text
POST /v1/bds/poll
Authorization: Bearer <token>

{
  "protocolVersion": "1.0.0",
  "messageType": "poll",
  "requestId": "req_def456",
  "sessionId": "session_xyz789",
  "timestamp": "2025-01-01T00:00:02.000Z"
}
```

**Response (action available):**

```text
HTTP/1.1 200 OK

{
  "protocolVersion": "1.0.0",
  "messageType": "poll_response",
  "requestId": "req_def456",
  "sessionId": "session_xyz789",
  "timestamp": "2025-01-01T00:00:02.050Z",
  "action": {
    "messageType": "action_request",
    "actionId": "action_001",
    "idempotencyKey": "idem_001",
    "toolName": "world.fill_blocks",
    "arguments": {
      "dimension": "minecraft:overworld",
      "region": { "min": { "x": 0, "y": 64, "z": 0 }, "max": { "x": 9, "y": 64, "z": 9 } },
      "blockType": "minecraft:stone",
      "captureRollback": true
    },
    "actor": "pi-agent",
    "permissionMode": "confirm_every_change",
    "risk": "normal",
    "approval": {
      "approvalId": "approval_001",
      "approvedAt": "2025-01-01T00:00:01.500Z",
      "approvedBy": "webview",
      "payloadHash": "a1b2c3d4..."
    },
    "expiresAt": "2025-01-01T00:05:02.000Z"
  }
}
```

**Response (no action):**

```text
HTTP/1.1 200 OK

{
  "protocolVersion": "1.0.0",
  "messageType": "poll_response",
  "requestId": "req_def456",
  "sessionId": "session_xyz789",
  "timestamp": "2025-01-01T00:00:02.050Z",
  "action": null
}
```

**Controller behavior:**
- Validates session exists (returns `401` if not)
- Dequeues the next non-expired, non-emergency-blocked action
- Skips expired actions automatically

### Events

**Direction:** BDS Addon → Controller

```text
POST /v1/bds/events
Authorization: Bearer <token>

{
  "protocolVersion": "1.0.0",
  "messageType": "operation_event",
  "requestId": "req_ghi789",
  "sessionId": "session_xyz789",
  "timestamp": "2025-01-01T00:00:03.000Z",
  "operationId": "op_001",
  "actionId": "action_001",
  "state": "completed",
  "completedWork": 100,
  "totalEstimatedWork": 100,
  "message": "Filled 100 blocks with minecraft:stone",
  "result": {
    "blocksChanged": 100,
    "dimension": "minecraft:overworld"
  }
}
```

**Operation states:**

| State | Meaning |
|-------|---------|
| `running` | Operation is in progress (batch execution) |
| `completed` | All work finished successfully |
| `partially_completed` | Some work done, some failed or skipped |
| `failed` | Operation failed |
| `cancelled` | Operation was cancelled |

**Controller behavior:**
- Validates session and message schema
- Stores the event in `EventStore`
- Logs to audit trail
- Notifies `AgentRuntime.onOperationEvent()` (in `src/agent/lifecycle/operations.ts`) for task state transitions
- Broadcasts to SSE subscribers

### Heartbeat

**Direction:** BDS Addon → Controller (every 3rd poll / ~6 seconds)

```text
POST /v1/bds/heartbeat
Authorization: Bearer <token>

{
  "protocolVersion": "1.0.0",
  "messageType": "heartbeat",
  "requestId": "req_jkl012",
  "sessionId": "session_xyz789",
  "timestamp": "2025-01-01T00:00:06.000Z",
  "serverId": "my-bds-server",
  "health": {
    "ok": true,
    "playerCount": 5,
    "tick": 12345,
    "emergencyDisabled": false
  }
}
```

**Controller behavior:**
- Updates `lastHeartbeatAt` and `lastHealth` on the session
- Returns `401` if session is unknown (triggers re-handshake)
- Health data is exposed via `/v1/health` for the webview

## SSE Streaming

### Task Planning Stream

**Endpoint:** `POST /v1/tasks/stream`

The webview opens an SSE connection when creating a task. The request body includes a `mode` field (`"ask"` or `"agent"`, defaults to `"ask"`) which is validated against `AI_MODES`. The controller streams real-time events as the AI plans:

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
Content-Encoding: identity

event: ready
data: {"ok":true}

event: status
data: {"text":"Planning response…"}

event: reasoning_delta
data: {"text":"The user wants to fill a 10x10 area..."}

event: delta
data: {"text":"I'll inspect the region first to check what's there."}

event: tool
data: {"name":"inspect_region","phase":"start","toolCallId":"tc_001"}

event: tool
data: {"name":"inspect_region","phase":"end","toolCallId":"tc_001"}

event: delta
data: {"text":"The region is clear. I'll fill it with stone."}

event: tool
data: {"name":"submit_plan","phase":"start","toolCallId":"tc_002"}

event: task
data: {"id":"task_abc","state":"awaiting_approval","plan":{...}}

event: tool
data: {"name":"submit_plan","phase":"end","toolCallId":"tc_002"}
```

**Event types:**

| Event | Data | When |
|-------|------|------|
| `ready` | `{ ok: true }` | Connection established |
| `delta` | `{ text }` | Model text token |
| `reasoning_delta` | `{ text }` | Model reasoning/thinking token |
| `status` | `{ text }` | Status update (planning, inspecting, etc.) |
| `tool` | `{ name, phase, toolCallId, detail?, isError? }` | Tool execution start/end |
| `task` | `{ task }` | Final task object with plan |
| `error` | `{ message }` | Planning failed |

**SSE headers:**
- `X-Accel-Buffering: no` — prevents proxy buffering
- `Content-Encoding: identity` — no compression for streaming
- Socket `setNoDelay(true)` — minimal latency

### Task Continuation Stream

**Endpoint:** `POST /v1/tasks/:id/stream`

Same SSE format as the initial task stream. Used for follow-up messages in the same conversation. The controller calls `agent.continueTask()` which sends the follow-up to the same Pi session with prior chat history. The `mode` field is optional on follow-ups — if omitted, the task retains its original mode.

### Event Stream

**Endpoint:** `GET /v1/events/stream`

Streams operation events in real-time as they arrive from the BDS addon:

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8

event: ready
data: {"ok":true}

event: operation
data: {"receivedAt":"2025-01-01T00:00:03.000Z","event":{...}}

event: operation
data: {"receivedAt":"2025-01-01T00:00:05.000Z","event":{...}}

: ping
```

**Behavior:**
- Keeps connection alive with `: ping` comments every 15 seconds
- Unsubscribes on client disconnect
- Returns the most recent 5000 events from the `EventStore`

## Safety Flow

### Risk Classification

Every action is classified by the `classify()` function in `policy.ts:47`:

```text
Action arrives
    │
    ├── toolName starts with "inspect." ──> risk: "read"
    │
    ├── toolName == "control.cancel" ──> risk: "normal"
    │
    ├── toolName == "control.emergency_disable" ──> risk: "strong"
    │
    ├── toolName == "admin.run_command"
    │       │
    │       ├── commandId in allowlist ──> risk: from config (normal/strong)
    │       └── commandId NOT in allowlist ──> risk: "prohibited"
    │
    └── world.fill_blocks (or other mutation)
            │
            ├── region volume > MAX_BUILD_VOLUME (32^3) ──> risk: "prohibited"
            │
            ├── region overlaps protected region ──> risk: "prohibited"
            │
            ├── blockType == "minecraft:air" OR volume > STRONG_BUILD_VOLUME (4096)
            │       ──> risk: "strong"
            │
            └── otherwise ──> risk: "normal"
```

### Permission Modes

The `enforceMode()` function in `policy.ts:99` gates mutations:

| Mode | Behavior |
|------|----------|
| `observe_only` | Deny all mutations |
| `confirm_every_change` | Require approval for every mutation (default) |
| `allow_low_risk` | Permit `world.fill_blocks` with volume ≤ 256 without approval; confirm others |
| `builder_region` | Deny `admin.run_command`; require builds to be inside assigned regions |
| `trusted_administrator` | Permit normal-risk mutations without approval; retain strong/prohibited gates |

### AI Mode Enforcement

The `validatePlanTools()` function in `src/agent/planning/planner.ts` enforces the AI capability boundary:

| Mode | Behavior |
|------|----------|
| `ask` (default) | Plan must have empty `actions` and `verification` arrays. Inspection-only plans complete immediately as chat responses. |
| `agent` | Full planning pipeline. Mutations require user approval. Verification steps run after mutations. |

Mode is set at task creation and cannot be changed mid-task. The controller validates the plan after the AI produces it — if Ask mode produces a plan with mutations, the plan is rejected and the AI is asked to retry (up to 2 attempts with validation feedback).

### Approval Binding

When approval is required (`approvalRequired()` in `policy.ts:83`):

1. Controller computes `SHA-256(stableStringify(approvalPayload(action)))` → `payloadHash`
2. Returns `409 APPROVAL_REQUIRED` with `{ payloadHash, risk, action }` to the webview
3. Webview displays the exact action to the user
4. User clicks Approve → webview sends approval with `{ approvedBy, payloadHash }`
5. Controller verifies `approval.payloadHash === computed hash`
6. Controller verifies approval is not stale (5-minute window)
7. Action is enqueued only if both checks pass

```text
Action submitted
    │
    ├── risk == "read" ──> Enqueue immediately (no approval)
    │
    ├── risk == "strong" ──> Always require approval
    │
    ├── mode == "trusted_administrator" AND risk == "normal"
    │       ──> Enqueue without approval
    │
    ├── mode == "allow_low_risk" AND tool == "world.fill_blocks" AND volume <= 256
    │       ──> Enqueue without approval
    │
    └── otherwise ──> Require approval
            │
            ├── No approval in request ──> 409 APPROVAL_REQUIRED
            │
            ├── Hash mismatch ──> 409 APPROVAL_INVALID
            │
            ├── Approval > 5 min old ──> 409 APPROVAL_EXPIRED
            │
            └── Hash matches, not stale ──> Enqueue
```

### Protected Region Enforcement

Protected regions are checked at two layers:

1. **Controller** (`policy.ts:74`): Before enqueue, checks if the action's region overlaps any protected region. Returns `prohibited` risk.
2. **BDS Addon** (`tools/mutate.ts`): At execution time, independently checks protected regions against the world.

```text
Action with region R
    │
    ├── For each protected region P in same dimension:
    │       │
    │       ├── regionsOverlap(R, P) == true
    │       │       ──> risk: "prohibited" (controller)
    │       │       ──> REJECT (addon)
    │       │
    │       └── regionsOverlap(R, P) == false
    │               ──> Continue checking
    │
    └── No overlap found ──> Proceed
```

### Emergency Disable

```text
POST /v1/emergency-disable
{
  "sessionId": "session_xyz789",
  "disabled": true,
  "actor": "admin"
}
```

When emergency disable is active:
- `SessionStore.isEmergencyDisabled(sessionId)` returns `true`
- Controller blocks all non-read mutations at enqueue time (`src/routes/bds.ts`)
- BDS addon skips non-read actions during dequeue (`store.ts:95`)
- Heartbeat reports `emergencyDisabled: true` to the webview
- The webview shows a prominent emergency-disable indicator
- Can only be toggled via the explicit `/v1/emergency-disable` endpoint

## Inspection Flow

The AI agent queries the world through a bridge that connects Pi's inspection tools to the BDS addon:

```text
 ┌─────────────┐     ┌─────────────────────┐     ┌─────────────┐     ┌─────────────┐
 │  Pi Agent   │     │ Controller          │     │ Session     │     │  BDS Addon  │
 │  (runtime)  │     │  (agent/inspection/) │     │  Store      │     │  (tools/)   │
 └──────┬──────┘     └──────┬──────────────┘     └──────┬──────┘     └──────┬──────┘
        │                   │                   │                   │
        │ 1. AI calls       │                   │                   │
        │ inspect_region()  │                   │                   │
        │──────────────────>│                   │                   │
        │                   │                   │                   │
        │                   │ 2. Materialize    │                   │
        │                   │ ActionRequest     │                   │
        │                   │ (risk: "read")    │                   │
        │                   │──────────────────>│                   │
        │                   │                   │                   │
        │                   │ 3. Enqueue action │                   │
        │                   │ (no approval)     │                   │
        │                   │──────────────────>│                   │
        │                   │                   │                   │
        │                   │ 4. Wait for       │ 5. BDS polls      │
        │                   │ result (Promise)  │<──────────────────│
        │                   │                   │                   │
        │                   │                   │ 6. Action returned│
        │                   │                   │──────────────────>│
        │                   │                   │                   │
        │                   │                   │                   │ 7. Execute
        │                   │                   │                   │ inspect tool
        │                   │                   │                   │ (world query)
        │                   │                   │                   │
        │                   │                   │ 8. POST /v1/bds/events
        │                   │                   │<──────────────────│
        │                   │                   │                   │
        │                   │ 9. EventStore     │                   │
        │                   │ receives event    │                   │
        │                   │<──────────────────│                   │
        │                   │                   │                   │
        │                   │ 10. Inspection    │                   │
        │                   │ waiter resolves   │                   │
        │                   │ (Promise resolves)│                   │
        │<──────────────────│                   │                   │
        │                   │                   │                   │
        │ 11. AI receives   │                   │                   │
        │ world state       │                   │                   │
```

**Key implementation details** (from `src/agent/inspection/bridge.ts`):

- Inspection tools are bridged via `setPiInspectionExecutor()` — the controller injects a callback that routes `inspect.*` calls through the session store (defined in `src/agent/inspection/bridge.ts`)
- The inspection creates an `ActionRequestMessage` with `risk: "read"` (no approval needed)
- The action is enqueued and a Promise is created with a 30-second timeout
- The controller's `onOperationEvent()` resolves the Promise when the BDS addon reports back
- The resolved result is injected into Pi's chat history via `injectPiToolResult()`
- If the timeout fires, the inspection is rejected with an error

**Available inspection tools** (13 total):

| Tool | Arguments | Returns |
|------|-----------|---------|
| `inspect.server_status` | `{ includeDimensions? }` | TPS, player count, tick, dimensions |
| `inspect.players` | `{ nameFilter? }` | Array of online player objects |
| `inspect.player` | `{ name }` | Detailed info for a single player |
| `inspect.block` | `{ dimension, position }` | Block type and state at position |
| `inspect.region` | `{ dimension, region, countsOnly? }` | Block type counts in region |
| `inspect.world_state` | `{ dimension?, rules? }` | Time, weather, game rules |
| `inspect.entities` | `{ dimension, typeFilter?, limit? }` | Entity list with positions |
| `inspect.scoreboard` | `{ objective? }` | Scoreboard objectives and scores |
| `inspect.tags` | `{ target, player? }` | Tags on a player or entity |
| `inspect.heightmap` | `{ dimension, region, resolution? }` | Terrain heights across a region |
| `inspect.surface` | `{ dimension, region }` | Top solid block types |
| `inspect.build_collision` | `{ dimension, region }` | Blocks in a proposed build volume |
| `inspect.find_empty_area` | `{ dimension, origin, requiredSize, radius? }` | Find empty build areas near origin |

## Task Lifecycle State Machine

```text
                         ┌──────────────┐
                         │  submitted   │
                         └──────┬───────┘
                                │
                                v
                         ┌──────────────┐
                         │   planning   │  AI model generating plan
                         └──────┬───────┘
                                │
                    ┌───────────┼───────────┐
                    v           v           v
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │ inspect- │ │ awaiting │ │ planned  │
             │  ing     │ │_approval │ │(reads    │
             │          │ │          │ │  only)   │
             └────┬─────┘ └────┬─────┘ └────┬─────┘
                  │            │            │
                  │            v            │
                  │     ┌──────────┐       │
                  │     │ rejected │       │
                  │     └──────────┘       │
                  │                        │
                  v                        v
             ┌──────────┐          ┌──────────┐
             │ planning │          │  running │  (after approval)
             │ (replan) │          └────┬─────┘
             └──────────┘               │
                                        v
                                 ┌──────────┐
                                 │verifying │  post-mutation reads
                                 └────┬─────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    v                 v                 v
             ┌──────────┐     ┌──────────┐      ┌──────────┐
             │ completed│     │ partial  │      │ failed   │
             └──────────┘     └──────────┘      └──────────┘

   At any non-terminal state: ──> cancelled (via cancel task)
```

**Mode effects on transitions:**

- **Ask mode**: Plans always produce empty `actions` and `verification` arrays. The task transitions `planning` → `completed` (chat-only) or `planning` → `inspecting` → `completed` (if inspection steps are present). No `awaiting_approval`, `running`, or `verifying` states are reached.
- **Agent mode**: All transitions are available as shown above.

**State transitions:**

| From | To | Trigger |
|------|----|---------|
| `submitted` | `planning` | Task creation begins |
| `planning` | `inspecting` | Plan has inspection steps + mutations |
| `planning` | `awaiting_approval` | Plan has mutations, no inspection |
| `planning` | `completed` | Chat-only (no inspection/actions) |
| `planning` | `planned` | Inspection only, no mutations |
| `planning` | `failed` | Planning error |
| `inspecting` | `planning` | Replan after inspection completes |
| `inspecting` | `completed` | Inspection only, all done |
| `awaiting_approval` | `running` | User approves |
| `awaiting_approval` | `rejected` | User rejects |
| `running` | `verifying` | Mutations done, verification pending |
| `running` | `completed` | All actions done, no verification |
| `running` | `partial` | Some actions failed |
| `running` | `failed` | All actions failed |
| `verifying` | `completed` | Verification reads done |
| `verifying` | `partial` | Verification partially failed |
| Any non-terminal | `cancelled` | User cancels task |
