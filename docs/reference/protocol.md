# IntelaCraft Protocol Reference

## Protocol Version

**Current Version:** `1.0.0`

The protocol follows [Semantic Versioning](https://semver.org/):

- **Major** version bump: Incompatible message format changes
- **Minor** version bump: New message types or fields (backward compatible)
- **Patch** version bump: Bug fixes, clarifications

Compatibility rule: A major version mismatch between controller and behavior pack causes a handshake failure. Minor and patch differences are tolerated.

## Live Content Catalog

After a successful handshake, BDS posts a `catalog_snapshot` containing the live block, item, and entity identifiers. The controller keeps the snapshot in memory per BDS session and exposes local `catalog.search` and `catalog.resolve` operations to Pi; searches do not poll BDS or include the full catalog in model context. Catalog identifiers must use a namespaced form such as `minecraft:stone` or `my_pack:custom_block`. The add-on revalidates block identifiers immediately before mutation.

---

## Message Envelope

All protocol messages share a common envelope structure defined by `MessageEnvelope`:

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "handshake",
  "requestId": "req-abc",
  "sessionId": "session-abc",
  "timestamp": "2026-07-10T12:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| protocolVersion | string | yes | Protocol version (e.g. `"1.0.0"`) |
| messageType | string | yes | One of the 9 message types |
| requestId | string | yes | Unique request identifier |
| sessionId | string | yes | Session identifier |
| timestamp | string | yes | ISO 8601 timestamp |

---

## Message Types

### HandshakeMessage

**Direction:** BDS → Controller

Initiates the session. BDS sends this on startup or reconnect.

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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| serverId | string | yes | Unique server identifier |
| clientProtocolVersion | string | yes | Protocol version the client speaks |
| capabilities | string[] | no | Tools this server supports |

---

### HandshakeAckMessage

**Direction:** Controller → BDS

Acknowledges the handshake and establishes the session.

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

| Field | Type | Description |
|-------|------|-------------|
| acceptedProtocolVersion | string | Controller's protocol version |
| serverId | string | Echoed server ID |
| ok | boolean | Whether handshake succeeded |
| error | object? | Error details when `ok` is false |

---

### PollMessage

**Direction:** BDS → Controller

Periodic poll for pending actions. BDS sends this every 0.5 seconds (10 ticks).

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "poll",
  "requestId": "req-002",
  "sessionId": "session-abc",
  "timestamp": "2026-07-10T12:00:02Z"
}
```

No additional fields beyond the envelope.

---

### PollResponseMessage

**Direction:** Controller → BDS

Returns a single pending action (or null) for the addon to execute.

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

| Field | Type | Description |
|-------|------|-------------|
| action | ActionRequestMessage \| null | Single pending action, or null if queue is empty |

---

### ActionRequestMessage

**Direction:** Controller → BDS (via poll response)

Represents a single action awaiting execution. Contains the full context needed for the addon to execute or reject the action.

```json
{
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
  "approval": {
    "approvalId": "apr-001",
    "approvedAt": "2026-07-10T12:00:00Z",
    "approvedBy": "webview",
    "payloadHash": "a1b2c3d4..."
  },
  "expiresAt": "2026-07-10T12:05:01Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| actionId | string | Unique action identifier |
| idempotencyKey | string | Deduplication key |
| toolName | ToolName | Tool to execute |
| arguments | object | Tool-specific arguments |
| actor | string | Who created the action |
| permissionMode | PermissionMode | Active permission mode |
| risk | RiskClass | Classified risk level |
| approval | ApprovalRecord? | Approval with SHA-256 payload hash |
| noApprovalReason | string? | Why approval was skipped |
| expiresAt | string | ISO 8601 expiration time |

---

### OperationEventMessage

**Direction:** BDS → Controller

Reports progress or completion of an operation.

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

| Field | Type | Description |
|-------|------|-------------|
| operationId | string | Operation identifier |
| actionId | string | Action being reported on |
| state | OperationState | `running`, `completed`, `partially_completed`, `failed`, `cancelled` |
| completedWork | number | Work completed so far |
| totalEstimatedWork | number | Total estimated work |
| message | string | Human-readable progress message |
| result | unknown? | Final result data (when completed) |
| error | ProtocolErrorBody? | Error details (when failed) |

---

### HeartbeatMessage

**Direction:** BDS → Controller

Periodic health report. BDS sends this every 3rd poll (6 seconds).

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

| Field | Type | Description |
|-------|------|-------------|
| serverId | string | Server identifier |
| health.ok | boolean | Overall health status |
| health.playerCount | number | Connected player count |
| health.tick | number? | Current server tick |
| health.emergencyDisabled | boolean? | Whether emergency disable is active |

---

### ErrorMessage

**Direction:** Either direction

Generic error notification.

```json
{
  "protocolVersion": "1.0.0",
  "messageType": "error",
  "requestId": "req-006",
  "sessionId": "session-abc",
  "timestamp": "2026-07-10T12:00:00Z",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid block type: diamond_blockk"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| error.code | string | Error code constant |
| error.message | string | Human-readable description |
| error.details | unknown? | Additional error context |

---

## Tool Catalog

The agent has access to 18 tools split into two categories: inspection (read-only) and mutation (world-modifying).

### Inspection Tools (13)

These tools are always safe, read-only operations with risk class `read`.

#### inspect.server_status

Returns server health and player list.

```json
{ "toolName": "inspect.server_status", "arguments": { "includeDimensions": true } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| includeDimensions | boolean | no | Include per-dimension info |

**Returns:** `{ playerCount: number, players: PlayerInfo[], dimensions?: object }`

---

#### inspect.players

Lists online players with optional name filter.

```json
{ "toolName": "inspect.players", "arguments": { "nameFilter": "Steve" } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| nameFilter | string | no | Case-insensitive name substring filter |

**Returns:** `{ players: [{ name, position, dimension, gamemode }] }`

---

#### inspect.player

Detailed info for a single online player.

```json
{ "toolName": "inspect.player", "arguments": { "name": "Steve" } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| name | string | yes | Exact gamertag of an online player |

**Returns:** `{ name, position, dimension, gamemode, health, inventory, armor, effects }`

---

#### inspect.block

Reads block data at a specific position.

```json
{ "toolName": "inspect.block", "arguments": { "dimension": "minecraft:overworld", "position": { "x": 0, "y": 64, "z": 0 } } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| dimension | DimensionId | yes | Target dimension |
| position | Vec3i | yes | Block coordinates |

**Returns:** `{ dimension, position, typeId, isAir, isLiquid, isWaterlogged }`

---

#### inspect.region

Scans blocks in a rectangular region.

```json
{ "toolName": "inspect.region", "arguments": { "dimension": "minecraft:overworld", "region": { "min": { "x": 0, "y": 64, "z": 0 }, "max": { "x": 10, "y": 70, "z": 10 } }, "countsOnly": true } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| dimension | DimensionId | yes | Target dimension |
| region | RegionBounds | yes | Bounding box (`min`/`max`) |
| countsOnly | boolean | no | Return per-block type counts only (default: true) |

**Returns:** `{ dimension, region, blockCounts: Record<string, number>, totalBlocks: number }`

**Validation:** Region volume must not exceed `MAX_REGION_VOLUME` (32,768 blocks).

---

#### inspect.world_state

Returns time, weather, and game rules for a dimension.

```json
{ "toolName": "inspect.world_state", "arguments": { "dimension": "minecraft:overworld", "rules": ["doDaylightCycle", "doWeatherCycle"] } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| dimension | DimensionId | no | Target dimension (default: overworld) |
| rules | string[] | no | Specific rule names (default: common rules) |

**Returns:** `{ dimension, timeOfDay, absoluteTime, day, weather, rules: Record<string, unknown> }`

---

#### inspect.entities

Lists entities in a dimension with optional type filter.

```json
{ "toolName": "inspect.entities", "arguments": { "dimension": "minecraft:overworld", "typeFilter": "zombie", "limit": 32 } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| dimension | DimensionId | yes | Target dimension |
| typeFilter | string | no | Case-insensitive entity type filter |
| limit | number | no | Soft cap (default 64, max 128) |

**Returns:** `{ entities: [{ id, typeId, position, nameTag }], count: number }`

---

#### inspect.scoreboard

Returns scoreboard objectives and entries.

```json
{ "toolName": "inspect.scoreboard", "arguments": { "objective": "goals" } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| objective | string | no | Specific objective (all if omitted) |

**Returns:** `{ objectives: [{ name, criteria, entries: [{ player, score }] }] }`

---

#### inspect.tags

Returns tags for a target entity or player.

```json
{ "toolName": "inspect.tags", "arguments": { "target": "Steve", "player": true } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| target | string | yes | Player name, player ID, entity ID, or nameTag |
| player | boolean | no | Prefer player lookup (default: true) |

**Returns:** `{ target, tags: string[] }`

---

#### inspect.heightmap

Returns height values across a region.

```json
{ "toolName": "inspect.heightmap", "arguments": { "dimension": "minecraft:overworld", "region": { "min": { "x": 0, "y": 0, "z": 0 }, "max": { "x": 10, "y": 0, "z": 10 } }, "resolution": 2 } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| dimension | DimensionId | yes | Target dimension |
| region | RegionBounds | yes | Region to scan |
| resolution | 1 \| 2 \| 4 | no | Sample every Nth block (default: 1) |

**Returns:** `{ dimension, region, resolution, heights: number[][] }`

---

#### inspect.surface

Returns surface block types across a region.

```json
{ "toolName": "inspect.surface", "arguments": { "dimension": "minecraft:overworld", "region": { "min": { "x": 0, "y": 0, "z": 0 }, "max": { "x": 10, "y": 0, "z": 10 } }, "resolution": 2 } }
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| dimension | DimensionId | yes | Target dimension |
| region | RegionBounds | yes | Region to scan |
| resolution | 1 \| 2 \| 4 | no | Sample every Nth block (default: 1) |

**Returns:** `{ dimension, region, surface: Array<{ position, typeId }> }`

---

#### inspect.build_collision

Checks whether a proposed build region collides with existing non-air blocks.

```json
{ "toolName": "inspect.build_collision", "arguments": { "dimension": "minecraft:overworld", "region": { "min": { "x": 0, "y": 64, "z": 0 }, "max": { "x": 10, "y": 70, "z": 10 } } } }
```

**Returns:** `{ dimension, region, collisionCount: number, collisions: Array<{ position, typeId }> }`

---

#### inspect.find_empty_area

Finds an empty rectangular area near an origin.

```json
{ "toolName": "inspect.find_empty_area", "arguments": { "dimension": "minecraft:overworld", "origin": { "x": 0, "y": 64, "z": 0 }, "requiredSize": { "x": 10, "y": 6, "z": 10 }, "radius": 32 } }
```

**Returns:** `{ found: boolean, position?: Vec3i, bounds?: RegionBounds }`

---

### Mutation Tools (5)

These tools modify the world or server state and have varying risk classes.

#### world.fill_blocks

Places or replaces blocks in a rectangular region.

```json
{
  "toolName": "world.fill_blocks",
  "arguments": {
    "dimension": "minecraft:overworld",
    "region": { "min": { "x": 0, "y": 64, "z": 0 }, "max": { "x": 10, "y": 70, "z": 10 } },
    "blockType": "minecraft:stone",
    "batchSize": 512,
    "captureRollback": true
  }
}
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| dimension | DimensionId | yes | Target dimension |
| region | RegionBounds | yes | Bounding box (`min`/`max`) |
| blockType | string | yes | Minecraft block identifier |
| batchSize | number | no | Blocks per batch (default: 512) |
| captureRollback | boolean | no | Capture blocks before overwriting (default: true) |

**Risk classification:**
- `normal` — volume ≤ 4,096 blocks
- `strong` — volume ≤ 32,768 blocks
- `prohibited` — volume > 32,768 blocks

---

#### world.place_blocks

Places individual blocks at specific positions.

```json
{
  "toolName": "world.place_blocks",
  "arguments": {
    "dimension": "minecraft:overworld",
    "blocks": [
      { "position": { "x": 0, "y": 64, "z": 0 }, "blockType": "minecraft:oak_door" },
      { "position": { "x": 0, "y": 65, "z": 0 }, "blockType": "minecraft:oak_door" }
    ],
    "batchSize": 512,
    "captureRollback": true
  }
}
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| dimension | DimensionId | yes | Target dimension |
| blocks | BlockPlacement[] | yes | Array of position/blockType pairs |
| batchSize | number | no | Blocks per batch (default: 512) |
| captureRollback | boolean | no | Capture blocks before overwriting |

**Limit:** Maximum 8,192 individually addressed blocks (`MAX_PLACE_BLOCKS`).

---

#### control.cancel

Cancels a running operation.

```json
{
  "toolName": "control.cancel",
  "arguments": {
    "actionId": "action-001"
  }
}
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| actionId | string | yes | Action to cancel |

---

#### control.emergency_disable

Immediately halts all pending and in-progress mutations.

```json
{
  "toolName": "control.emergency_disable",
  "arguments": {
    "disabled": true
  }
}
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| disabled | boolean | yes | `true` to enable emergency mode, `false` to disable |

**Risk:** `strong`. This is the only mutation tool that can interrupt another in-progress mutation.

---

#### admin.run_command

Executes an allowlisted BDS command by ID.

```json
{
  "toolName": "admin.run_command",
  "arguments": {
    "commandId": "time_day"
  }
}
```

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| commandId | string | yes | Allowlisted command ID (resolved by controller) |
| command | string | no | Resolved command string (set by controller, revalidated by addon) |

**Validation:**
- `commandId` must be in the `INTELACRAFT_ADMIN_COMMANDS` allowlist
- The controller resolves the command string before enqueueing
- The addon revalidates the command at execution time

---

## Enumerated Types

### Tool Names

```typescript
READ_TOOLS = [
  "inspect.server_status", "inspect.players", "inspect.player",
  "inspect.block", "inspect.region", "inspect.world_state",
  "inspect.entities", "inspect.scoreboard", "inspect.tags",
  "inspect.heightmap", "inspect.surface", "inspect.build_collision",
  "inspect.find_empty_area"
]

MUTATION_TOOLS = [
  "world.fill_blocks", "world.place_blocks",
  "control.cancel", "control.emergency_disable",
  "admin.run_command"
]
```

### Risk Classes

```typescript
RISK_CLASSES = ["read", "normal", "strong", "prohibited"]
```

### Permission Modes

```typescript
PERMISSION_MODES = [
  "observe_only",          // Read-only — AI inspects but never modifies
  "confirm_every_change",  // Every mutation needs approval (default)
  "allow_low_risk",        // Normal-risk auto-approved, strong needs approval
  "builder_region",        // Builds restricted to configured regions
  "trusted_administrator"  // All changes trusted (use with caution)
]
```

### AI Modes

```typescript
AI_MODES = ["ask", "agent"]
```

| Mode | Description |
|------|-------------|
| `ask` | Read-only — AI inspects the world and answers questions, but never proposes mutations (default) |
| `agent` | Full planning — AI can inspect, propose mutations, and include verification steps |

### Operation States

```typescript
OPERATION_STATES = [
  "running",              // Operation in progress
  "completed",            // Operation finished successfully
  "partially_completed",  // Some work done, some failed
  "failed",               // Operation failed
  "cancelled"             // Operation was cancelled
]
```

### Thinking Levels

```typescript
THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
```

### Dimension IDs

```typescript
DIMENSION_IDS = [
  "minecraft:overworld",
  "minecraft:nether",
  "minecraft:the_end"
]
```

---

## Constants

These constants define operational limits enforced by both the controller and behavior pack.

| Constant | Value | Description |
|----------|-------|-------------|
| `PROTOCOL_VERSION` | `"1.0.0"` | Current protocol version |
| `MAX_REGION_VOLUME` | 32,768 | Maximum blocks in a single region inspection query (32^3) |
| `MAX_BUILD_VOLUME` | 32,768 | Maximum blocks in a single build operation (32^3) |
| `STRONG_BUILD_VOLUME` | 4,096 | Threshold for `strong` risk classification |
| `DEFAULT_BATCH_SIZE` | 512 | Default blocks placed per batch |
| `MAX_ROLLBACK_BLOCKS` | 8,192 | Maximum blocks that can be rolled back |
| `MAX_PLACE_BLOCKS` | 8,192 | Maximum individually addressed blocks in one placement |

---

## Approval Binding

Mutations require a SHA-256 hash of the exact action payload that was displayed to the user.

1. Controller computes `payloadHash = SHA-256(stableStringify(action))` when presenting the action
2. User approves in the webview; the hash is sent back with the approval
3. Controller verifies `approval.payloadHash === computedHash` before enqueueing
4. Approval expires after 5 minutes

This prevents:
- Modified payloads (different args, risk, or tool)
- Replay attacks (reusing an old approval)
- Stale approvals (expired hash)

---

## Idempotency

Action deduplication prevents the same operation from being executed multiple times.

1. Client includes an `idempotencyKey` when creating an action
2. Controller checks if an action with the same key already exists
3. If the previous action is pending or approved: returns the existing action ID
4. If the previous action completed successfully: returns the existing action with its result
5. If the previous action failed or was rejected: allows a new action with the same key

Keys are stored for 24 hours, then purged.
