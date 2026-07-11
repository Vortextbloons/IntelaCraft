# IntelaCraft API Reference

Base URL: `http://127.0.0.1:8787`

## Authentication

All `/v1/*` routes require Bearer token authentication via the `Authorization` header, **except** `/v1/health` which is unauthenticated.

```
Authorization: Bearer <INTELACRAFT_BDS_TOKEN>
```

Responses return `401` if the token is missing or invalid.

---

## Health

### GET /v1/health

System health check. **No authentication required.**

**Response** `200 OK`

```json
{
  "ok": true,
  "protocolVersion": "1.0.0",
  "bdsConnected": true,
  "sessions": [
    {
      "sessionId": "session-abc",
      "serverId": "my-bds",
      "protocolVersion": "1.0.0",
      "connectedAt": "2026-07-10T12:00:00Z",
      "lastHeartbeatAt": "2026-07-10T12:00:06Z",
      "heartbeatAgeMs": 6000,
      "connected": true,
      "health": { "ok": true, "playerCount": 3, "tick": 142000 },
      "emergencyDisabled": false
    }
  ],
  "settings": {
    "permissionMode": "confirm_every_change",
    "thinkingLevel": "medium",
    "preferredThinkingLevel": "medium"
  },
  "agent": {
    "pi": true,
    "sessions": 1,
    "providers": 2,
    "activeProviderId": "provider-abc",
    "mcp": { "configured": false, "available": false, "advisoryOnly": true }
  }
}
```

---

## BDS Communication

### POST /v1/bds/handshake

Register a BDS instance and obtain a session ID.

**Request Body** (full `MessageEnvelope` format)

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "handshake",
  "requestId": "req-001",
  "sessionId": "",
  "timestamp": "2026-07-10T12:00:00Z",
  "serverId": "my-bds",
  "clientProtocolVersion": "1.0.0",
  "capabilities": ["fill_blocks", "place_blocks", "cancel"]
}
```

**Response** `200 OK` (`HandshakeAckMessage`)

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "handshake_ack",
  "requestId": "req-001",
  "sessionId": "session-abc",
  "timestamp": "2026-07-10T12:00:00Z",
  "acceptedProtocolVersion": "1.0.0",
  "serverId": "my-bds",
  "ok": true
}
```

**Errors:**
- `400 PROTOCOL_INCOMPATIBLE` — major version mismatch

---

### POST /v1/bds/poll

Poll for a pending action. BDS calls this every 2 seconds (40 ticks).

**Request Body** (`PollMessage`)

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "poll",
  "requestId": "req-002",
  "sessionId": "session-abc",
  "timestamp": "2026-07-10T12:00:02Z"
}
```

**Response** `200 OK` (`PollResponseMessage`)

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "poll_response",
  "requestId": "req-002",
  "sessionId": "session-abc",
  "timestamp": "2026-07-10T12:00:02Z",
  "action": {
    "protocolVersion": "1.0.0",
    "messageType": "action_request",
    "requestId": "req-003",
    "sessionId": "session-abc",
    "timestamp": "2026-07-10T12:00:01Z",
    "actionId": "action-001",
    "idempotencyKey": "idem-001",
    "toolName": "world.fill_blocks",
    "arguments": {
      "dimension": "minecraft:overworld",
      "region": { "min": { "x": 0, "y": 64, "z": 0 }, "max": { "x": 10, "y": 70, "z": 10 } },
      "blockType": "minecraft:stone"
    },
    "actor": "controller",
    "permissionMode": "confirm_every_change",
    "risk": "normal",
    "expiresAt": "2026-07-10T12:05:01Z"
  }
}
```

When no action is queued, `action` is `null`.

---

### POST /v1/bds/events

Report operation results back to the controller.

**Request Body** (`OperationEventMessage`)

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "operation_event",
  "requestId": "req-004",
  "sessionId": "session-abc",
  "timestamp": "2026-07-10T12:00:03Z",
  "operationId": "op-001",
  "actionId": "action-001",
  "state": "running",
  "completedWork": 64,
  "totalEstimatedWork": 128,
  "message": "Placed 64 of 128 blocks"
}
```

**States:** `running`, `completed`, `partially_completed`, `failed`, `cancelled`

**Response** `200 OK`

```json
{ "ok": true }
```

---

### POST /v1/bds/heartbeat

Periodic health report. BDS sends this every 3rd poll (6 seconds).

**Request Body** (`HeartbeatMessage`)

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "heartbeat",
  "requestId": "req-005",
  "sessionId": "session-abc",
  "timestamp": "2026-07-10T12:00:06Z",
  "serverId": "my-bds",
  "health": {
    "ok": true,
    "playerCount": 3,
    "tick": 142000,
    "emergencyDisabled": false
  }
}
```

**Response** `200 OK`

```json
{ "ok": true }
```

---

## Actions

### POST /v1/actions

Enqueue a new action for execution. Accepts either a full `ActionRequestMessage` envelope or a simplified draft.

**Request Body (simplified draft)**

```json
{
  "toolName": "world.fill_blocks",
  "arguments": {
    "dimension": "minecraft:overworld",
    "region": { "min": { "x": 0, "y": 64, "z": 0 }, "max": { "x": 10, "y": 70, "z": 10 } },
    "blockType": "minecraft:stone"
  },
  "risk": "normal",
  "idempotencyKey": "idem-build-house"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| toolName | string | yes | Tool name (e.g. `world.fill_blocks`, `inspect.block`) |
| arguments | object | yes | Tool-specific arguments |
| risk | string | no | Risk class (auto-classified if omitted) |
| idempotencyKey | string | no | Deduplication key |
| sessionId | string | no | Target session (uses first active session if omitted) |

**Response** `202 Accepted`

```json
{
  "ok": true,
  "actionId": "action-001",
  "sessionId": "session-abc",
  "idempotencyKey": "idem-build-house"
}
```

**Errors:**
- `403 POLICY_DENIED` — permission mode blocks this action
- `409 APPROVAL_REQUIRED` — action requires approval; response includes `approval.payloadHash`
- `409 APPROVAL_INVALID` — hash mismatch
- `409 APPROVAL_EXPIRED` — approval is stale (>5 minutes)
- `409 DUPLICATE_ACTION` — idempotency key conflict
- `503 EMERGENCY_DISABLED` — emergency disable is active

---

## Events

### GET /v1/events

List the 100 most recent operation events.

**Response** `200 OK`

```json
{
  "events": [
    {
      "protocolVersion": "1.0.0",
      "messageType": "operation_event",
      "sessionId": "session-abc",
      "operationId": "op-001",
      "actionId": "action-001",
      "state": "completed",
      "completedWork": 128,
      "totalEstimatedWork": 128,
      "message": "Fill complete"
    }
  ]
}
```

---

### GET /v1/events/stream

SSE event stream for real-time operation events. Heartbeat pings every 15 seconds.

**Response** `text/event-stream`

```
event: ready
data: {"ok":true}

event: operation
data: {"messageType":"operation_event","actionId":"action-001","state":"running",...}
```

---

## Activity

### GET /v1/activity

Query activity records with optional filters.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| taskId | string | Filter by task ID |
| actionId | string | Filter by action ID |
| operationId | string | Filter by operation ID |
| type | string | Filter by activity type |
| since | ISO 8601 | Filter after timestamp |
| limit | number | Max records (default 100) |

**Response** `200 OK`

```json
{
  "records": [
    {
      "id": "act-001",
      "type": "task_created",
      "taskId": "task-001",
      "actionId": null,
      "timestamp": "2026-07-10T12:00:00Z",
      "data": {}
    }
  ]
}
```

---

### DELETE /v1/activity

Purge activity records.

**Response** `200 OK`

```json
{ "ok": true, "removed": 42 }
```

---

## Settings

### GET /v1/settings

Get current settings including available admin commands.

**Response** `200 OK`

```json
{
  "permissionMode": "confirm_every_change",
  "thinkingLevel": "medium",
  "preferredThinkingLevel": "medium",
  "adminCommands": [
    { "id": "time_day", "label": "Set time to day", "risk": "normal" }
  ]
}
```

---

### PATCH /v1/settings

Update settings.

**Request Body** (all fields optional)

```json
{
  "permissionMode": "allow_low_risk",
  "thinkingLevel": "high"
}
```

| Field | Type | Values |
|-------|------|--------|
| permissionMode | string | `observe_only`, `confirm_every_change`, `allow_low_risk`, `builder_region`, `trusted_administrator` |
| thinkingLevel | string | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

**Response** `200 OK`

```json
{
  "permissionMode": "allow_low_risk",
  "thinkingLevel": "high",
  "preferredThinkingLevel": "high"
}
```

---

## Emergency

### POST /v1/emergency-disable

Toggle emergency disable state. When active, no non-read mutations pass.

**Request Body**

```json
{
  "disabled": true,
  "sessionId": "session-abc",
  "actor": "user"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| disabled | boolean | no | `true` to enable, `false` to disable (default: `true`) |
| sessionId | string | no | Target session (uses first active session if omitted) |
| actor | string | no | Who triggered the disable |

**Response** `200 OK`

```json
{
  "ok": true,
  "sessionId": "session-abc",
  "emergencyDisabled": true
}
```

---

## Providers

### GET /v1/providers

List all configured AI providers and the active one.

**Response** `200 OK`

```json
{
  "providers": [
    {
      "id": "provider-abc",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o"
    }
  ],
  "activeProviderId": "provider-abc"
}
```

---

### POST /v1/providers

Create or update a provider configuration.

**Request Body**

```json
{
  "id": "provider-abc",
  "name": "OpenAI",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4o"
}
```

**Response** `201 Created`

```json
{
  "provider": { "id": "provider-abc", "name": "OpenAI", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o" }
}
```

---

### POST /v1/providers/active

Set the active provider.

**Request Body**

```json
{ "providerId": "provider-abc" }
```

**Response** `200 OK`

```json
{ "ok": true }
```

---

### POST /v1/providers/:id/test

Test a provider connection by making a minimal chat completion request.

**Response** `200 OK`

```json
{ "ok": true, "latency": 340, "model": "gpt-4o" }
```

---

### POST /v1/providers/:id/models

Discover available models for a provider via the `/models` endpoint.

**Response** `200 OK`

```json
{
  "models": [
    { "id": "gpt-4o", "name": "GPT-4o", "reasoning": { "supported": false, "levels": [], "preferredLevel": "off", "source": "provider" } },
    { "id": "o3-mini", "name": "o3-mini", "reasoning": { "supported": true, "levels": ["low", "medium", "high"], "preferredLevel": "medium", "source": "override" } }
  ]
}
```

---

## MCP

### GET /v1/mcp/status

Get MCP (Model Context Protocol) connection status.

**Response** `200 OK`

```json
{
  "configured": false,
  "available": false,
  "advisoryOnly": true
}
```

---

## Pi Sessions

### POST /v1/pi/sessions

Create a new Pi agent session bound to a provider.

**Request Body**

```json
{ "providerId": "default" }
```

**Response** `201 Created`

```json
{
  "session": {
    "id": "pi-session-abc",
    "providerId": "provider-abc",
    "createdAt": "2026-07-10T12:00:00Z"
  }
}
```

---

### GET /v1/pi/sessions

List all Pi sessions.

**Response** `200 OK`

```json
{
  "sessions": [
    { "id": "pi-session-abc", "providerId": "provider-abc", "createdAt": "2026-07-10T12:00:00Z" }
  ]
}
```

---

## Tasks

### POST /v1/tasks

Create a new task (non-streaming). The agent plans synchronously and returns the completed task.

**Request Body**

```json
{
  "request": "Build a 10x10 stone house at 0 64 0",
  "piSessionId": "pi-session-abc",
  "bdsSessionId": "session-abc",
  "permissionMode": "confirm_every_change"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| request | string | yes | Natural language task description |
| piSessionId | string | no | Pi session to use (creates new if omitted) |
| bdsSessionId | string | no | BDS session target (uses first active if omitted) |
| permissionMode | string | no | Override permission mode for this task |

**Response** `201 Created`

```json
{
  "task": {
    "id": "task-001",
    "state": "awaiting_approval",
    "request": "Build a 10x10 stone house at 0 64 0",
    "summary": "I'll build a 10x10 stone house at coordinates 0, 64, 0.",
    "proposedActions": [...],
    "chatHistory": [...],
    "createdAt": "2026-07-10T12:00:00Z"
  }
}
```

---

### POST /v1/tasks/stream

Create a task with SSE streaming for real-time progress.

**Request Body**

```json
{
  "request": "Build a 10x10 stone house at 0 64 0",
  "piSessionId": "pi-session-abc",
  "bdsSessionId": "session-abc"
}
```

**Response** `text/event-stream`

```
event: ready
data: {"ok":true}

event: delta
data: {"text":"I'll"}

event: delta
data: {"text":" build"}

event: reasoning_delta
data: {"text":"Analyzing the target location..."}

event: status
data: {"text":"Planning inspection steps..."}

event: tool
data: {"toolName":"inspect.block","phase":"start","arguments":{...}}

event: tool
data: {"toolName":"inspect.block","phase":"end","result":{...}}

event: task
data: {"task":{"id":"task-001","state":"awaiting_approval",...}}
```

**SSE event types:**

| Event | Data | Description |
|-------|------|-------------|
| `ready` | `{ ok: true }` | Stream established |
| `delta` | `{ text: string }` | Model text token |
| `reasoning_delta` | `{ text: string }` | Reasoning/thinking token |
| `status` | `{ text: string }` | Status update message |
| `tool` | `{ toolName, phase, arguments, result? }` | Tool execution start/end |
| `task` | `{ task }` | Final task object |
| `error` | `{ message: string }` | Planning failed |

---

### POST /v1/tasks/:id/stream

Continue a conversation on an existing task. Appends a new user message and streams the agent's response.

**Request Body**

```json
{
  "request": "Now add a door on the south side",
  "piSessionId": "pi-session-abc"
}
```

**Response** `text/event-stream` — same format as `POST /v1/tasks/stream`.

---

### GET /v1/tasks

List all tasks.

**Response** `200 OK`

```json
{
  "tasks": [
    {
      "id": "task-001",
      "state": "completed",
      "request": "Build a 10x10 stone house",
      "summary": "Built a 10x10 stone house at 0, 64, 0.",
      "createdAt": "2026-07-10T12:00:00Z"
    }
  ]
}
```

---

### GET /v1/tasks/:id

Get detailed task information including transcript.

**Response** `200 OK`

```json
{
  "task": {
    "id": "task-001",
    "state": "awaiting_approval",
    "request": "Build a 10x10 stone house",
    "summary": "I'll build a 10x10 stone house...",
    "proposedActions": [
      {
        "actionId": "action-001",
        "toolName": "world.fill_blocks",
        "arguments": { ... },
        "risk": "normal",
        "requiresApproval": true
      }
    ],
    "chatHistory": [ ... ],
    "createdAt": "2026-07-10T12:00:00Z"
  },
  "transcript": [
    { "role": "user", "content": "Build a 10x10 stone house" },
    { "role": "assistant", "content": "I'll build a 10x10 stone house..." }
  ]
}
```

---

### DELETE /v1/tasks/:id

Delete a task and its associated data.

**Response** `200 OK`

```json
{ "ok": true }
```

---

### POST /v1/tasks/:id/approve

Approve a task's proposed mutations. Read-only actions in `proposedActions` are auto-enqueued without explicit approval.

**Request Body**

```json
{
  "approvedBy": "webview"
}
```

**Response** `200 OK`

```json
{
  "task": { "id": "task-001", "state": "running", ... }
}
```

---

### POST /v1/tasks/:id/reject

Reject a task's proposed plan.

**Request Body**

```json
{
  "rejectedBy": "webview",
  "reason": "Plan is too aggressive, reduce batch size"
}
```

**Response** `200 OK`

```json
{
  "task": { "id": "task-001", "state": "rejected", ... }
}
```

---

### POST /v1/tasks/:id/cancel

Cancel a running or pending task.

**Request Body**

```json
{
  "cancelledBy": "webview"
}
```

**Response** `200 OK`

```json
{
  "task": { "id": "task-001", "state": "cancelled", ... }
}
```

---

### POST /v1/tasks/:id/replan

Edit the task with user notes and request a new plan. The notes are sent back to the AI agent as a follow-up message.

**Request Body**

```json
{
  "notes": "Use cobblestone instead of stone, and make it 12x12",
  "history": [ ... ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| notes | string | no | Modification instructions (defaults to "Please revise the plan.") |
| history | Message[] | no | Chat history to include for context |

**Response** `200 OK`

```json
{
  "task": { "id": "task-001", "state": "planning", ... }
}
```

---

## Task States

```
submitted → planning → inspecting → awaiting_approval → running → verifying → completed
                       ↓                                  ↓
                    awaiting_approval                  failed
                       ↓                                  ↓
                    rejected                          cancelled
```

| State | Description |
|-------|-------------|
| `submitted` | Task created, waiting to start |
| `planning` | Agent is generating a plan |
| `inspecting` | Inspection steps running, mutations deferred |
| `awaiting_approval` | Plan ready, waiting for user approval |
| `running` | Mutations executing |
| `verifying` | Post-mutation verification in progress |
| `completed` | All steps finished successfully |
| `rejected` | User rejected the plan |
| `cancelled` | User or system cancelled |
| `failed` | An error occurred |
| `partial` | Task persisted across controller restart (resumable) |

---

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | `BAD_REQUEST` | Invalid request body or parameters |
| 400 | `PROTOCOL_INCOMPATIBLE` | Protocol major version mismatch |
| 400 | `RISK_MISMATCH` | Auto-classified risk doesn't match declared risk |
| 400 | `UNKNOWN_COMMAND` | Admin command ID not in allowlist |
| 401 | `NO_SESSION` | Unknown or expired session |
| 403 | `POLICY_DENIED` | Permission mode blocks this action |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `APPROVAL_REQUIRED` | Action needs approval; includes `approval.payloadHash` |
| 409 | `APPROVAL_INVALID` | Approval hash doesn't match action payload |
| 409 | `APPROVAL_EXPIRED` | Approval is stale (>5 minutes) |
| 409 | `DUPLICATE_ACTION` | Idempotency key conflict |
| 500 | `INTERNAL` | Server-side error |
| 503 | `EMERGENCY_DISABLED` | Emergency disable is active |
