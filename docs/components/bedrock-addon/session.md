# Session Lifecycle

Documents the full lifecycle of a ControllerSession, from startup through polling, heartbeats, and action dispatch.

## Entry Point (`main.ts`)

```
system.run() → next tick
  ├── loadConfig()
  ├── if !config.configured → notifyOperators(missing vars), return
  ├── new ControllerSession(config)
  ├── session.start()
  └── notifyOperators("Controller session started")
```

The addon loads on the next server tick via `system.run()`. It checks configuration first; if required variables are missing, it notifies operators and stops. Otherwise it creates a `ControllerSession` and calls `start()`.

## Config Loading (`config.ts`)

### Variables and Secrets

| BDS Key | Accessor | Required | Notes |
|---------|----------|----------|-------|
| `intelacraft:controller_url` | `variables.get()` | Yes | Trimmed, trailing `/` stripped |
| `intelacraft:bds_token` | `secrets.get()` | Yes | Stored as `SecretString` |
| `intelacraft:server_id` | `variables.get()` | No | Defaults to `"bds-default"` |
| `intelacraft:protected_regions` | `variables.get()` | No | Parsed as JSON array |
| `intelacraft:admin_commands` | `variables.get()` | No | Parsed as JSON object |

### AddonConfig Interface

```typescript
interface AddonConfig {
  controllerUrl: string;
  authToken: SecretString | string | undefined;
  serverId: string;
  configured: boolean;           // true when missing.length === 0
  missing: string[];
  protectedRegions: Array<{
    dimension: string;
    region: { min: {x,y,z}; max: {x,y,z} };
  }>;
  adminCommands: Record<string, {
    command: string;
    risk?: string;
    label?: string;
  }>;
}
```

JSON parse failures for `protected_regions` and `admin_commands` add descriptive error strings (e.g. `"intelacraft:protected_regions (invalid JSON)"`) to the `missing` array.

## HTTP Client (`net/client.ts`)

### ControllerClient

```typescript
class ControllerClient {
  constructor(baseUrl: string, authToken: SecretString | string)
  async postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }>
}
```

- **Timeout**: 10 seconds per request
- **Headers**: `Content-Type: application/json`, `Authorization: <authToken>`
- **Response**: JSON-parsed body; non-2xx throws `Error` with `error.message` from response
- **SecretString handling**: The auth token is passed directly as the full `Authorization` header value. It must already be formatted as `"Bearer <token>"` — `SecretString` cannot be concatenated in script.

## Session Lifecycle (`net/session.ts`)

### Constants

```typescript
const POLL_INTERVAL_TICKS = 40;          // ~2 seconds
const HEARTBEAT_EVERY_N_POLLS = 3;       // heartbeat every 3 polls (~6s)
```

### ControllerSession Class

```typescript
class ControllerSession {
  private client: ControllerClient;
  private sessionId: string | null = null;
  private running = false;
  private busy = false;
  private pollCount = 0;
  private readonly idempotency = createIdempotencyTracker();
}
```

### start()

1. Guard: if `this.running` is already `true`, return immediately (double-start protection)
2. Set `this.running = true`
3. Register `system.runInterval()` calling `tick()` every `POLL_INTERVAL_TICKS` (40 ticks)
4. Call `handshake()` immediately (not awaited — fire-and-forget via `void`)

### handshake()

```
POST /v1/bds/handshake
  body: createHandshake({
    sessionId: "pending",
    requestId: newId("req"),
    serverId: config.serverId,
    capabilities: ["inspect.read"]
  })

Response: validateHandshakeAck(body)
  ├── Two-level ok check:
  │   ├── parsed.ok === false → validation error → sessionId = null
  │   └── parsed.value.ok === false → controller rejected → sessionId = null
  └── parsed.value.ok === true → sessionId = parsed.value.sessionId
```

On 401 or any error, `sessionId` is set to `null` so the next `tick()` will retry the handshake.

### tick()

```
if (busy) return          // busy guard — skip overlapping ticks
busy = true
try {
  if (!sessionId)         // no session → re-handshake
    await handshake()
    return
  pollCount++
  if (pollCount % 3 === 0)
    await sendHeartbeat()
  await pollOnce()
} finally {
  busy = false
}
```

### sendHeartbeat()

```
POST /v1/bds/heartbeat
  body: createHeartbeat({
    sessionId,
    requestId: newId("req"),
    serverId,
    health: {
      ok: true,
      playerCount: world.getPlayers().length,
      tick: system.currentTick,
      emergencyDisabled: isEmergencyDisabled()
    }
  })

Response handling:
  ├── status 401 → sessionId = null (force re-handshake)
  └── other → fire-and-forget
```

### pollOnce()

```
POST /v1/bds/poll
  body: createPoll({ sessionId, requestId: newId("req") })

Response:
  ├── status 401 → sessionId = null, return
  ├── validatePollResponse(body) fails → notifyOperators, return
  ├── parsed.value.action === undefined → no action, return
  └── parsed.value.action exists → handleAction(action)
```

### handleAction()

```
1. validateActionRequest(rawAction)
   └── invalid → emitFailure(DUPLICATE or validation error)

2. isExpired(action.expiresAt)
   └── expired → emitFailure(EXPIRED)

3. idempotency.checkAndRemember(action.idempotencyKey)
   └── duplicate → emitFailure(DUPLICATE)

4. Dispatch by toolName:
   ├── "world.fill_blocks"  → startFill(action, emit, protectedRegions)
   ├── "control.*"          → executeControl(action) → emitEvent
   ├── "admin.run_command"  → executeAdminCommand(action, adminCommands) → emitEvent
   └── "inspect.*"          → executeInspectTool(action) → emitEvent
```

### emitEvent()

```
POST /v1/bds/events
  body: createOperationEvent({
    sessionId,
    requestId: newId("req"),
    operationId: newId("op"),
    actionId,
    state: "completed" | "failed" | "partially_completed" | "cancelled" | "running",
    completedWork,
    totalEstimatedWork,
    message,
    result?,
    error?
  })
```

Fire-and-forget: errors in event emission are silently ignored.

## Session Lifecycle Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         main.ts                                 │
│  system.run() → loadConfig() → new ControllerSession() → start()│
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    handshake()   │──POST /v1/bds/handshake──▶ Controller
                    │  sessionId=null  │◀── 200 {sessionId} ──────│
                    └────────┬────────┘                           │
                             │                                    │
                             ▼                                    │
               ┌──────────────────────────┐                      │
               │     tick() [every 40t]   │                      │
               │  ┌─────────────────────┐ │                      │
               │  │ if busy → skip      │ │                      │
               │  │ if !sessionId →     │ │                      │
               │  │   handshake()       │ │                      │
               │  │ if pollCount%3==0 → │ │                      │
               │  │   sendHeartbeat()   │ │──POST /v1/bds/heartbeat
               │  │ pollOnce()          │ │──POST /v1/bds/poll──▶│
               │  │   └─ handleAction() │ │◀── { action? } ──────│
               │  │      └─ emitEvent() │ │──POST /v1/bds/events─▶│
               │  └─────────────────────┘ │                      │
               └──────────────────────────┘                      │
                             │                                    │
                             ▼                                    │
                    ┌─────────────────┐                           │
                    │  401 on any     │──sessionId = null─────────┘
                    │  request        │   (next tick re-handshakes)
                    └─────────────────┘
```

## Error Handling Patterns

| Pattern | Usage |
|---------|-------|
| `void this.handshake()` | Fire-and-forget for initial handshake (non-critical) |
| `void this.tick()` | Interval callback ignores returned promise |
| `void this.emitEvent(...)` | Fill tool emits events without blocking |
| `try/catch` in `handshake()` | Catches network errors, sets `sessionId = null` |
| `try/catch` in `tick()` | Ensures `busy = false` via `finally` block |
| `sessionId = null` on 401 | Forces re-handshake on auth failure |
| `notifyOperators()` | Logs to operators + console on errors |
| `emitFailure()` | Sends structured error events to controller |
