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
  "version": "1.0.0",
  "uptime": 3600,
  "bds": { "connected": true, "sessionId": "abc-123" }
}
```

---

## BDS Communication

### POST /v1/bds/handshake

Register a BDS instance and obtain a session ID.

**Request Body**

```json
{
  "serverId": "my-server",
  "version": "1.21.0",
  "mods": []
}
```

**Response** `200 OK`

```json
{
  "sessionId": "bds-session-uuid",
  "actions": [],
  "permissions": {}
}
```

| Field | Type | Description |
|-------|------|-------------|
| sessionId | string | Unique session identifier |
| actions | Action[] | Any pending actions for the server |
| permissions | object | Current permission configuration |

---

### POST /v1/bds/poll

Poll for pending actions. BDS calls this periodically to check for queued work.

**Request Body**

```json
{
  "sessionId": "bds-session-uuid"
}
```

**Response** `200 OK`

```json
{
  "actions": [
    {
      "id": "action-uuid",
      "type": "fill_blocks",
      "tool": "world.fill_blocks",
      "args": {},
      "risk": "normal",
      "approval": "approved",
      "requestedAt": "2026-07-10T12:00:00Z"
    }
  ],
  "rejected": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| actions | Action[] | Actions approved for execution |
| rejected | string[] | Action IDs that were rejected |

---

### POST /v1/bds/events

Report operation results back to the controller.

**Request Body**

```json
{
  "sessionId": "bds-session-uuid",
  "actionId": "action-uuid",
  "status": "success",
  "result": {
    "blocksPlaced": 128,
    "duration": 450
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| status | "success" \| "error" | Operation outcome |
| result | object | Operation-specific result data |

**Response** `200 OK`

```json
{ "ok": true }
```

---

### POST /v1/bds/heartbeat

Send periodic health updates from BDS to the controller.

**Request Body**

```json
{
  "sessionId": "bds-session-uuid",
  "players": 3,
  "tps": 20,
  "memory": { "used": 1024, "max": 4096 }
}
```

**Response** `200 OK`

```json
{
  "ok": true,
  "emergencyDisabled": false
}
```

---

## Actions

### POST /v1/actions

Enqueue a new action for execution.

**Request Body**

```json
{
  "tool": "world.fill_blocks",
  "args": {
    "from": { "x": 0, "y": 64, "z": 0 },
    "to": { "x": 10, "y": 70, "z": 10 },
    "block": "stone"
  },
  "risk": "normal",
  "idempotencyKey": "unique-key-123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tool | string | yes | Tool name from the tool catalog |
| args | object | yes | Tool-specific arguments |
| risk | string | no | Risk class override (read/normal/strong) |
| idempotencyKey | string | no | Deduplication key |

**Response** `201 Created`

```json
{
  "actionId": "action-uuid",
  "status": "pending",
  "risk": "normal",
  "requiresApproval": true
}
```

---

## Events

### GET /v1/events

List recent events.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | 50 | Max events to return |
| since | ISO 8601 | - | Filter events after this timestamp |
| type | string | - | Filter by event type |

**Response** `200 OK`

```json
{
  "events": [
    {
      "id": "event-uuid",
      "type": "action.completed",
      "timestamp": "2026-07-10T12:00:00Z",
      "data": {}
    }
  ]
}
```

---

### GET /v1/events/stream

SSE event stream for real-time events.

**Response** `text/event-stream`

```
event: action.created
data: {"actionId":"abc","tool":"world.fill_blocks"}

event: action.completed
data: {"actionId":"abc","status":"success"}
```

---

## Activity

### GET /v1/activity

Query activity records.

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
      "id": "activity-uuid",
      "type": "task.created",
      "taskId": "task-uuid",
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

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| since | ISO 8601 | Delete records before this timestamp |
| type | string | Delete only this activity type |

**Response** `200 OK`

```json
{ "deleted": 42 }
```

---

## Settings

### GET /v1/settings

Get current settings.

**Response** `200 OK`

```json
{
  "permissionMode": "confirm_every_change",
  "thinkingLevel": "medium",
  "emergencyDisabled": false,
  "protectedRegions": [],
  "builderRegions": []
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
| permissionMode | string | observe_only, confirm_every_change, allow_low_risk, builder_region, trusted_administrator |
| thinkingLevel | string | low, medium, high |

**Response** `200 OK`

```json
{
  "ok": true,
  "settings": { ... }
}
```

---

## Emergency

### POST /v1/emergency-disable

Toggle emergency disable state. When enabled, no mutations can be executed.

**Request Body**

```json
{
  "disabled": true
}
```

**Response** `200 OK`

```json
{
  "ok": true,
  "emergencyDisabled": true
}
```

---

## Providers

### GET /v1/providers

List all configured AI providers.

**Response** `200 OK`

```json
{
  "providers": [
    {
      "id": "provider-uuid",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4o",
      "isActive": true
    }
  ]
}
```

---

### POST /v1/providers

Create or update a provider configuration.

**Request Body**

```json
{
  "id": "provider-uuid",
  "name": "OpenAI",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4o"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | no | Provider ID (omit for new) |
| name | string | yes | Display name |
| baseUrl | string | yes | API endpoint URL |
| apiKey | string | yes | Authentication key |
| model | string | yes | Model identifier |

**Response** `200 OK`

```json
{
  "ok": true,
  "provider": { ... }
}
```

---

### POST /v1/providers/active

Set the active provider.

**Request Body**

```json
{
  "providerId": "provider-uuid"
}
```

**Response** `200 OK`

```json
{ "ok": true }
```

---

### POST /v1/providers/:id/test

Test a provider connection.

**Response** `200 OK`

```json
{
  "ok": true,
  "latency": 340,
  "model": "gpt-4o"
}
```

**Error** `502 Bad Gateway` if the provider is unreachable.

---

### POST /v1/providers/:id/models

Discover available models for a provider.

**Response** `200 OK`

```json
{
  "models": [
    { "id": "gpt-4o", "name": "GPT-4o" },
    { "id": "gpt-4o-mini", "name": "GPT-4o Mini" }
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
  "connected": true,
  "url": "http://localhost:3001",
  "toolsAvailable": 14
}
```

---

## Pi Sessions

### POST /v1/pi/sessions

Create a new Pi agent session.

**Request Body**

```json
{
  "task": "Build a 10x10 stone house",
  "context": {}
}
```

**Response** `201 Created`

```json
{
  "sessionId": "pi-session-uuid",
  "status": "active",
  "createdAt": "2026-07-10T12:00:00Z"
}
```

---

### GET /v1/pi/sessions

List all Pi sessions.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| status | string | Filter by status (active/completed/failed) |
| limit | number | Max sessions to return |

**Response** `200 OK`

```json
{
  "sessions": [
    {
      "sessionId": "pi-session-uuid",
      "task": "Build a 10x10 stone house",
      "status": "active",
      "createdAt": "2026-07-10T12:00:00Z"
    }
  ]
}
```

---

## Tasks

### POST /v1/tasks

Create a new task.

**Request Body**

```json
{
  "prompt": "Build a 10x10 stone house at 0 64 0",
  "thinkingLevel": "medium"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | yes | Natural language task description |
| thinkingLevel | string | no | Override thinking level for this task |

**Response** `201 Created`

```json
{
  "taskId": "task-uuid",
  "status": "planning",
  "createdAt": "2026-07-10T12:00:00Z"
}
```

---

### POST /v1/tasks/stream

Create a task with SSE streaming for real-time progress.

**Request Body**

```json
{
  "prompt": "Build a 10x10 stone house at 0 64 0"
}
```

**Response** `text/event-stream`

```
event: task.created
data: {"taskId":"task-uuid","status":"planning"}

event: task.thinking
data: {"taskId":"task-uuid","content":"Analyzing world state..."}

event: task.plan.ready
data: {"taskId":"task-uuid","plan":{...}}

event: task.waiting_approval
data: {"taskId":"task-uuid"}
```

---

### GET /v1/tasks

List tasks.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| status | string | Filter by status |
| limit | number | Max tasks (default 20) |
| before | ISO 8601 | Tasks created before this time |

**Response** `200 OK`

```json
{
  "tasks": [
    {
      "id": "task-uuid",
      "prompt": "Build a 10x10 stone house",
      "status": "completed",
      "createdAt": "2026-07-10T12:00:00Z",
      "completedAt": "2026-07-10T12:05:00Z"
    }
  ]
}
```

---

### GET /v1/tasks/:id

Get detailed task information.

**Response** `200 OK`

```json
{
  "id": "task-uuid",
  "prompt": "Build a 10x10 stone house",
  "status": "planning",
  "plan": {
    "steps": [
      {
        "tool": "world.fill_blocks",
        "args": {},
        "risk": "normal"
      }
    ]
  },
  "thinking": ["Analyzing world state...", "Planning build..."],
  "createdAt": "2026-07-10T12:00:00Z",
  "actions": []
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

Approve a task's proposed plan.

**Request Body**

```json
{
  "actionIds": ["action-uuid-1", "action-uuid-2"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| actionIds | string[] | no | Specific actions to approve (all if omitted) |

**Response** `200 OK`

```json
{
  "ok": true,
  "status": "executing"
}
```

---

### POST /v1/tasks/:id/reject

Reject a task's proposed plan.

**Request Body**

```json
{
  "reason": "Plan is too aggressive, reduce batch size"
}
```

**Response** `200 OK`

```json
{
  "ok": true,
  "status": "rejected"
}
```

---

### POST /v1/tasks/:id/cancel

Cancel a running or pending task.

**Response** `200 OK`

```json
{
  "ok": true,
  "status": "cancelled"
}
```

---

### POST /v1/tasks/:id/replan

Edit the task prompt and request a new plan.

**Request Body**

```json
{
  "prompt": "Build a 10x10 cobblestone house instead",
  "editNote": "Changed material to cobblestone"
}
```

**Response** `200 OK`

```json
{
  "ok": true,
  "status": "planning"
}
```

---

### POST /v1/tasks/:id/stream

Continue a task with SSE streaming (e.g., after approval or replan).

**Response** `text/event-stream`

```
event: task.executing
data: {"taskId":"task-uuid"}

event: action.progress
data: {"actionId":"action-uuid","blocksPlaced":64,"total":128}

event: task.completed
data: {"taskId":"task-uuid","result":{...}}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "error_code",
  "message": "Human-readable description"
}
```

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | bad_request | Invalid request body or parameters |
| 401 | unauthorized | Missing or invalid bearer token |
| 403 | forbidden | Insufficient permissions for this action |
| 404 | not_found | Resource does not exist |
| 409 | conflict | Resource state conflict (e.g., task already completed) |
| 422 | validation_error | Request body failed validation |
| 429 | rate_limited | Too many requests |
| 500 | internal_error | Server-side error |
| 502 | bad_gateway | Upstream provider unreachable |
| 503 | emergency_disabled | Emergency disable is active |
