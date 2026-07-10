# IntelaCraft Protocol Reference

## Protocol Version

**Current Version:** `1.0.0`

The protocol follows [Semantic Versioning](https://semver.org/):

- **Major** version bump: Incompatible message format changes
- **Minor** version bump: New message types or fields (backward compatible)
- **Patch** version bump: Bug fixes, clarifications

Compatibility rule: A major version mismatch between controller and behavior pack causes a handshake failure. Minor and patch differences are tolerated.

---

## Message Types

All messages are JSON objects with a required `type` field identifying the message kind.

---

### HandshakeMessage

**Direction:** BDS → Controller

Initiates the session. BDS sends this on startup or reconnect.

```json
{
  "type": "handshake",
  "serverId": "my-server",
  "version": "1.0.0",
  "protocolVersion": "1.0.0",
  "bdsVersion": "1.21.0",
  "mods": ["script-api-v2"],
  "capabilities": ["fill_blocks", "cancel"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | yes | `"handshake"` |
| serverId | string | yes | Unique server identifier |
| version | string | yes | BDS add-on version |
| protocolVersion | string | yes | Protocol version this client speaks |
| bdsVersion | string | yes | Minecraft BDS version |
| mods | string[] | no | Loaded mods/capabilities |
| capabilities | string[] | no | Tools this server supports |

---

### HandshakeAckMessage

**Direction:** Controller → BDS

Acknowledges the handshake and returns session state.

```json
{
  "type": "handshake_ack",
  "sessionId": "session-uuid",
  "actions": [],
  "permissions": {
    "mode": "confirm_every_change",
    "protectedRegions": [],
    "builderRegions": []
  },
  "protocolVersion": "1.0.0"
}
```

| Field | Type | Description |
|-------|------|-------------|
| type | string | `"handshake_ack"` |
| sessionId | string | Session identifier for this connection |
| actions | Action[] | Any pending actions queued for execution |
| permissions | object | Current permission configuration |
| protocolVersion | string | Controller's protocol version |

---

### PollMessage

**Direction:** BDS → Controller

Periodic poll for pending actions. BDS sends this at the configured poll interval.

```json
{
  "type": "poll",
  "sessionId": "session-uuid",
  "lastPollAt": "2026-07-10T12:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | yes | `"poll"` |
| sessionId | string | yes | Active session ID |
| lastPollAt | ISO 8601 | no | Timestamp of last successful poll |

---

### PollResponseMessage

**Direction:** Controller → BDS

Response to a poll with queued actions.

```json
{
  "type": "poll_response",
  "actions": [
    {
      "id": "action-uuid",
      "type": "fill_blocks",
      "tool": "world.fill_blocks",
      "args": {
        "from": { "x": 0, "y": 64, "z": 0 },
        "to": { "x": 10, "y": 70, "z": 10 },
        "block": "stone"
      },
      "risk": "normal",
      "approval": "approved",
      "requestedAt": "2026-07-10T12:00:00Z",
      "idempotencyKey": "key-123"
    }
  ],
  "rejected": ["action-uuid-rejected"],
  "emergencyDisabled": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| type | string | `"poll_response"` |
| actions | Action[] | Actions approved for execution |
| rejected | string[] | Action IDs that were rejected |
| emergencyDisabled | boolean | Whether emergency disable is active |

---

### ActionRequestMessage

**Direction:** Controller → AI Agent (internal)

Internal message representing a proposed action awaiting approval or execution.

```json
{
  "type": "action_request",
  "actionId": "action-uuid",
  "tool": "world.fill_blocks",
  "args": {
    "from": { "x": 0, "y": 64, "z": 0 },
    "to": { "x": 10, "y": 70, "z": 10 },
    "block": "stone"
  },
  "risk": "normal",
  "approval": "pending",
  "idempotencyKey": "key-123",
  "requestedAt": "2026-07-10T12:00:00Z",
  "taskId": "task-uuid"
}
```

| Field | Type | Description |
|-------|------|-------------|
| type | string | `"action_request"` |
| actionId | string | Unique action identifier |
| tool | string | Tool name from the tool catalog |
| args | object | Tool-specific arguments |
| risk | string | Risk class (read/normal/strong/prohibited) |
| approval | string | Approval state: pending/approved/rejected |
| idempotencyKey | string | Deduplication key (optional) |
| requestedAt | ISO 8601 | When the action was created |
| taskId | string | Parent task ID (if applicable) |

---

### OperationEventMessage

**Direction:** BDS → Controller

Reports progress or completion of an operation.

```json
{
  "type": "operation_event",
  "actionId": "action-uuid",
  "sessionId": "session-uuid",
  "status": "progress",
  "progress": {
    "blocksPlaced": 64,
    "totalBlocks": 128,
    "percentComplete": 50
  }
}
```

```json
{
  "type": "operation_event",
  "actionId": "action-uuid",
  "sessionId": "session-uuid",
  "status": "success",
  "result": {
    "blocksPlaced": 128,
    "duration": 450
  }
}
```

```json
{
  "type": "operation_event",
  "actionId": "action-uuid",
  "sessionId": "session-uuid",
  "status": "error",
  "error": {
    "code": "REGION_PROTECTED",
    "message": "Target region overlaps a protected area"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| type | string | `"operation_event"` |
| actionId | string | Action being reported on |
| sessionId | string | Active session ID |
| status | string | `progress`, `success`, or `error` |
| progress | object | Progress details (when status=progress) |
| result | object | Final result (when status=success) |
| error | ErrorObject | Error details (when status=error) |

---

### HeartbeatMessage

**Direction:** BDS → Controller

Periodic health report. BDS sends this at the configured heartbeat interval.

```json
{
  "type": "heartbeat",
  "sessionId": "session-uuid",
  "timestamp": "2026-07-10T12:00:00Z",
  "players": 3,
  "tps": 20,
  "memory": {
    "usedMB": 1024,
    "maxMB": 4096
  },
  "uptime": 3600
}
```

| Field | Type | Description |
|-------|------|-------------|
| type | string | `"heartbeat"` |
| sessionId | string | Active session ID |
| timestamp | ISO 8601 | Current server time |
| players | number | Connected player count |
| tps | number | Ticks per second (target: 20) |
| memory.usedMB | number | Current memory usage |
| memory.maxMB | number | Maximum allocated memory |
| uptime | number | Seconds since server start |

---

### ErrorMessage

**Direction:** Either direction

Generic error notification.

```json
{
  "type": "error",
  "code": "VALIDATION_ERROR",
  "message": "Invalid block type: diamond_blockk",
  "source": "action-uuid",
  "recoverable": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| type | string | `"error"` |
| code | string | Error code constant |
| message | string | Human-readable description |
| source | string | Related entity ID (action, task, etc.) |
| recoverable | boolean | Whether the operation can be retried |

---

## Tool Catalog

The agent has access to 14 tools split into two categories: inspection (read-only) and mutation (world-modifying).

### Inspection Tools (10)

These tools are always safe, read-only operations with risk class `read`.

#### inspect.server_status

Returns server health, player count, TPS, and memory.

```json
{
  "tool": "inspect.server_status",
  "args": {}
}
```

**Returns:** `{ players: number, tps: number, memory: object, uptime: number }`

---

#### inspect.players

Lists all online players with their positions and states.

```json
{
  "tool": "inspect.players",
  "args": {}
}
```

**Returns:** `{ players: [{ name: string, position: Vec3, dimension: string, gamemode: string }] }`

---

#### inspect.block

Reads block data at a specific position.

```json
{
  "tool": "inspect.block",
  "args": { "position": { "x": 0, "y": 64, "z": 0 } }
}
```

**Returns:** `{ block: string, data: number, entities: Entity[] }`

---

#### inspect.region

Scans blocks in a rectangular region.

```json
{
  "tool": "inspect.region",
  "args": {
    "from": { "x": 0, "y": 64, "z": 0 },
    "to": { "x": 10, "y": 70, "z": 10 }
  }
}
```

**Returns:** `{ blocks: [{ position: Vec3, block: string }], count: number }`

**Validation:** Region volume must not exceed `MAX_REGION_VOLUME` (32768 blocks).

---

#### inspect.time

Returns the current in-game time.

```json
{
  "tool": "inspect.time",
  "args": {}
}
```

**Returns:** `{ time: number, daylight: boolean }`

---

#### inspect.weather

Returns the current weather state.

```json
{
  "tool": "inspect.weather",
  "args": {}
}
```

**Returns:** `{ weather: string, duration: number }`

---

#### inspect.game_rules

Returns all game rule values.

```json
{
  "tool": "inspect.game_rules",
  "args": {}
}
```

**Returns:** `{ rules: { [key: string]: string | number | boolean } }`

---

#### inspect.entities

Lists entities in a region.

```json
{
  "tool": "inspect.entities",
  "args": {
    "from": { "x": 0, "y": 64, "z": 0 },
    "to": { "x": 10, "y": 70, "z": 10 },
    "type": "minecraft:zombie"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| from | Vec3 | yes | Region start corner |
| to | Vec3 | yes | Region end corner |
| type | string | no | Filter by entity type |

**Returns:** `{ entities: [{ id: string, type: string, position: Vec3, nameTag: string }] }`

---

#### inspect.scoreboard

Returns scoreboard objectives and entries.

```json
{
  "tool": "inspect.scoreboard",
  "args": { "objective": "goals" }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| objective | string | no | Specific objective (all if omitted) |

**Returns:** `{ objectives: [{ name: string, criteria: string, entries: [{ player: string, score: number }] }] }`

---

#### inspect.tags

Returns tags for a specific entity.

```json
{
  "tool": "inspect.tags",
  "args": { "entityId": "entity-uuid" }
}
```

**Returns:** `{ tags: string[] }`

---

### Mutation Tools (4)

These tools modify the world or server state and have varying risk classes.

#### world.fill_blocks

Places or replaces blocks in a rectangular region. Risk: normal (≤512 blocks), strong (≤32768), prohibited (>32768).

```json
{
  "tool": "world.fill_blocks",
  "args": {
    "from": { "x": 0, "y": 64, "z": 0 },
    "to": { "x": 10, "y": 70, "z": 10 },
    "block": "stone",
    "replace": "air",
    "batchSize": 256
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| from | Vec3 | yes | Region start corner |
| to | Vec3 | yes | Region end corner |
| block | string | yes | Block type to place |
| replace | string | no | Only replace this block type |
| batchSize | number | no | Blocks per batch (default: 512) |

**Validation:**
- Region volume must not exceed `MAX_REGION_VOLUME` (32768 blocks)
- Build volume must not exceed `MAX_BUILD_VOLUME` (32768 blocks)
- Batch size must not exceed `DEFAULT_BATCH_SIZE` (512)
- Region must not overlap protected regions

---

#### control.cancel

Cancels a running operation. Risk: normal.

```json
{
  "tool": "control.cancel",
  "args": {
    "actionId": "action-uuid",
    "reason": "User requested cancellation"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| actionId | string | yes | Action to cancel |
| reason | string | no | Cancellation reason |

---

#### control.emergency_disable

Immediately halts all pending and in-progress operations. Risk: strong.

```json
{
  "tool": "control.emergency_disable",
  "args": {
    "enabled": true,
    "reason": "Unexpected world state detected"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| enabled | boolean | yes | Enable or disable emergency mode |
| reason | string | no | Reason for toggling |

**Note:** Emergency disable is the only mutation tool that can interrupt another in-progress mutation.

---

#### admin.run_command

Executes an allowlisted BDS command. Risk: depends on command.

```json
{
  "tool": "admin.run_command",
  "args": {
    "command": "time set day",
    "reason": "Reset daylight for build"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| command | string | yes | The BDS command to execute |
| reason | string | no | Justification for the command |

**Validation:**
- Command must be in the `INTELACRAFT_ADMIN_COMMANDS` allowlist
- Commands not in the allowlist are classified as `prohibited`
- The command string is parsed to prevent injection

---

## Constants

These constants define operational limits enforced by both the controller and behavior pack.

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_REGION_VOLUME` | 32,768 | Maximum blocks in a single region inspection query |
| `MAX_BUILD_VOLUME` | 32,768 | Maximum blocks in a single build operation |
| `DEFAULT_BATCH_SIZE` | 512 | Default blocks placed per batch in `fill_blocks` |
| `MAX_ROLLBACK_BLOCKS` | 8,192 | Maximum blocks that can be rolled back in a single undo operation |

### Derived Limits

| Limit | Calculation | Description |
|-------|-------------|-------------|
| Max fill region | `MAX_BUILD_VOLUME` blocks | A fill operation cannot exceed this total volume |
| Max batch size | `DEFAULT_BATCH_SIZE` blocks | Operations are chunked into batches of this size |
| Rollback capacity | `MAX_ROLLBACK_BLOCKS` blocks | Operations larger than this cannot be automatically undone |

---

## Validation Rules

### Region Validation

All region-based tools enforce:

1. **Volume limit:** `|x2-x1+1| * |y2-y1+1| * |z2-z1+1|` ≤ `MAX_REGION_VOLUME`
2. **Coordinate bounds:** All coordinates must be within world limits
3. **Protected regions:** Mutations must not overlap any protected region

### Block Validation

For `world.fill_blocks`:

1. **Block type must be valid:** Must be a recognized Minecraft block identifier
2. **Replace filter:** If specified, must be a valid block type
3. **Batch size:** Must be between 1 and `DEFAULT_BATCH_SIZE`
4. **Volume:** Total region volume must not exceed `MAX_BUILD_VOLUME`

### Command Validation

For `admin.run_command`:

1. **Allowlist check:** Command must start with an entry in `INTELACRAFT_ADMIN_COMMANDS`
2. **No injection:** Command is parsed to prevent argument injection
3. **Length limit:** Command string must not exceed 256 characters

### Entity Validation

For `inspect.tags`:

1. **Entity must exist:** The specified entity ID must reference a living entity
2. **Proximity:** Entity must be within render distance

---

## Idempotency

Action deduplication prevents the same operation from being executed multiple times.

### How It Works

1. **Client generates key:** When creating an action, the client optionally includes an `idempotencyKey` (any string, typically a UUID or hash)
2. **Controller checks:** Before enqueueing, the controller checks if an action with the same key already exists
3. **Deduplication rules:**
   - If an action with the same key is **pending or approved**: returns the existing action ID (no duplicate created)
   - If an action with the same key **completed successfully**: returns the existing action with its result
   - If an action with the same key **failed or was rejected**: allows a new action with the same key

### Example

```json
// First request
POST /v1/actions
{
  "tool": "world.fill_blocks",
  "args": { ... },
  "idempotencyKey": "build-house-at-0-64-0"
}

// Response: 201 Created
{ "actionId": "action-uuid-1", "status": "pending" }

// Duplicate request (same key)
POST /v1/actions
{
  "tool": "world.fill_blocks",
  "args": { ... },
  "idempotencyKey": "build-house-at-0-64-0"
}

// Response: 200 OK (returns existing)
{ "actionId": "action-uuid-1", "status": "pending" }
```

### Key Best Practices

- Use deterministic keys: hash of tool + args + task context
- Always include idempotency keys for retried operations
- Keys are stored for 24 hours, then purged
- Duplicate keys with different args are treated as separate actions (key must match exactly)
