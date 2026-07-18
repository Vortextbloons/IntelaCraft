# Mutation Tools

All 5 world-modifying tools. These tools execute within a single tick or via a generator for long-running fills and placements.

## Overview

Mutation tools are dispatched by `handleAction()` in `net/session.ts`. They check the `emergencyDisabled` flag before executing. Results are emitted as `OperationEvent` messages to the controller.

### MutationEvent Type

```typescript
interface MutationEvent {
  state: "running" | "completed" | "partially_completed" | "cancelled" | "failed";
  completedWork: number;
  totalEstimatedWork: number;
  message: string;
  result?: unknown;
  error?: { code: string; message: string };
}
```

---

## Tool Reference

### 1. world.fill_blocks

Fills a 3D region with a specified block type using a generator-based approach.

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dimension` | `DimensionId` | Yes | — | Target dimension |
| `region` | `RegionBounds` | Yes | — | `{ min: {x,y,z}, max: {x,y,z} }` |
| `blockType` | `string` | Yes | — | Block type ID (must match `/^minecraft:[a-z0-9_.-]+$/`) |
| `batchSize` | `number` | No | `512` | Blocks per yield interval |
| `captureRollback` | `boolean` | No | `false` | Store original blocks before modification |

#### Safety Checks (in order)

1. **Emergency disable**: Fails with `EMERGENCY_DISABLED` if global kill switch is active
2. **Volume limit**: Region volume must be ≤ `MAX_BUILD_VOLUME` (32768). Fails with `REGION_TOO_LARGE`
3. **Protected regions**: Fails with `PROTECTED_REGION` if fill region AABB overlaps any configured protected region in the same dimension

#### Generator Execution

The fill runs as a generator via `system.runJob()`, yielding control back to the server every `batchSize` blocks:

```
startFill()
  │
  ├── Safety checks (emergency, volume, protected regions)
  │
  ├── dimension = world.getDimension(args.dimension)
  │
  └── system.runJob(job())
        │
        ├── Triple nested loop: x → y → z
        │   ├── Check cancelled Set → emit "cancelled", return
        │   ├── Check emergencyDisabled → emit "cancelled", return
        │   ├── dimension.getBlock() → block unavailable? throw
        │   ├── captureRollback? → store {position, typeId} (max 8192)
        │   ├── block.setType(blockType)
        │   ├── completed++
        │   └── completed % batchSize === 0? → emit "running", yield
        │
        └── Loop complete → emit "completed"
```

#### Rollback Capture

When `captureRollback` is `true`, the tool stores `{ position: {x,y,z}, typeId }` for each block **before** modification. Maximum `MAX_ROLLBACK_BLOCKS` (8192) entries. The completion event includes:

```json
{
  "rollback": {
    "available": true,
    "captiveBlocks": 8192,
    "totalBlocks": 8192,
    "coverage": 1.0
  }
}
```

If the fill is partial or fails, `available` is `true` only if `rollback.length > 0`.

#### Progress Events

| State | When | Data |
|-------|------|------|
| `running` | Every `batchSize` blocks | `completedWork`, `totalEstimatedWork`, progress message |
| `completed` | All blocks placed | Final result with rollback metadata |
| `partially_completed` | Error after some blocks placed | Error details, partial rollback |
| `cancelled` | Cancelled or emergency disabled mid-fill | Cancellation message, rollback availability |
| `failed` | Pre-check failure or immediate error | Error code and message |

#### Cancellation

The `control.cancel` tool adds an `actionId` to a module-level `cancelled` Set. The fill generator checks this Set on every iteration. If found, it deletes the ID from the Set, emits a `"cancelled"` event, and returns. The `emergencyDisabled` flag is also checked per-iteration.

**Example**: *"Fill 10,64,10 to 20,74,20 with stone"*

---

### 2. world.place_blocks

Places individually addressed blocks at specific positions using a generator-based approach.

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dimension` | `DimensionId` | Yes | — | Target dimension |
| `blocks` | `Array<{position: Vec3i, blockType: string, states?: Record<string,string\|number\|boolean>}>` | Yes | — | 1–8192 position/block pairs with optional permutation states |
| `batchSize` | `number` | No | `512` | Blocks per yield interval |
| `captureRollback` | `boolean` | No | `false` | Store original blocks before modification |

#### Safety Checks (in order)

1. **Emergency disable**: Fails with `EMERGENCY_DISABLED` if global kill switch is active
2. **Block count**: Must be 1–`MAX_PLACE_BLOCKS` (8192). Fails with `INVALID_ARGS` if exceeded
3. **Protected regions**: Fails with `PROTECTED_REGION` if any block position overlaps a protected region

#### Generator Execution

The placement runs as a generator via `system.runJob()`, yielding control back to the server every `batchSize` blocks:

```
startPlaceBlocks()
  │
  ├── Safety checks (emergency, protected regions)
  │
  ├── dimension = world.getDimension(args.dimension)
  │
  └── system.runJob(job())
        │
        ├── For each { position, blockType, states } in blocks:
        │   ├── Check cancelled Set → emit "cancelled", return
        │   ├── Check emergencyDisabled → emit "cancelled", return
        │   ├── dimension.getBlock() → block unavailable? failed++
        │   ├── block type and requested states match? → skipped++
        │   ├── captureRollback? → store {position, typeId, states} (max 8192)
        │   ├── states? setPermutation(resolve(blockType, states)) : setType(blockType)
        │   └── (placed+skipped+failed) % batchSize === 0? → emit "running", yield
        │
        └── Loop complete → emit "completed" or "partially_completed"
```

#### Completion Result

```json
{
  "dimension": "minecraft:overworld",
  "placed": 128,
  "skipped": 2,
  "failed": 0,
  "rollback": {
    "available": true,
    "capturedBlocks": 128,
    "coverage": 1.0
  }
}
```

**Example**: *"Place an oak door at 5,64,5 and a torch at 5,65,5"*

---

### 3. control.cancel

Cancels a running action by its action ID.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `actionId` | `string` | Yes | ID of the action to cancel |

**Mechanism**: Adds the `actionId` to a module-level `cancelled` Set. Running operations (`world.fill_blocks`, `world.place_blocks`) check this Set per-iteration.

**Does not**:
- Immediately stop operations
- Remove the action from the controller
- Affect inspection tools (they complete synchronously)

**Returns**:

```json
{
  "state": "completed",
  "completedWork": 1,
  "totalEstimatedWork": 1,
  "message": "Cancellation requested"
}
```

**Example**: *"Cancel the current fill operation"*

---

### 4. control.emergency_disable

Global kill switch that halts all mutations until cleared.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `disabled` | `boolean` | Yes | `true` to enable, `false` to clear |

**Mechanism**: Sets a module-level `emergencyDisabled` flag.

**Effects when enabled**:
- `world.fill_blocks` → `EMERGENCY_DISABLED` error
- `world.place_blocks` → `EMERGENCY_DISABLED` error
- `admin.run_command` → `EMERGENCY_DISABLED` error
- `control.emergency_disable` itself still works (to clear)
- Fill/placement generators check per-iteration and cancel mid-run
- Reported in heartbeat health data (`emergencyDisabled: true`)

**Returns**:

```json
{
  "state": "completed",
  "completedWork": 1,
  "totalEstimatedWork": 1,
  "message": "Emergency disable enabled"
}
```

**Example**: *"Emergency stop all mutations"*

---

### 5. admin.run_command

Runs a pre-approved Minecraft command from the allowlist.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `commandId` | `string` | Yes | Key in the `admin_commands` allowlist |
| `command` | `string` | No | Optional command string for verification |

#### Safety Layers (in order)

1. **Emergency disable**: Fails with `EMERGENCY_DISABLED` if active
2. **Allowlist lookup**: Fails with `UNKNOWN_COMMAND` if `commandId` not in `adminCommands`
3. **Command mismatch**: If `command` argument is provided and doesn't match `entry.command`, fails with `COMMAND_MISMATCH`

#### Execution

- Runs on the **overworld** dimension via `dimension.runCommand(entry.command)`
- Returns `successCount` from the command result

**Returns**:

```json
{
  "state": "completed",
  "completedWork": 1,
  "totalEstimatedWork": 1,
  "message": "Ran allowlisted command time_day",
  "result": {
    "commandId": "time_day",
    "successCount": 1
  }
}
```

**Error examples**:

```json
{
  "error": { "code": "EMERGENCY_DISABLED", "message": "Mutations disabled" }
}
{
  "error": { "code": "UNKNOWN_COMMAND", "message": "commandId 'tp_player' is not allowlisted" }
}
{
  "error": { "code": "COMMAND_MISMATCH", "message": "Resolved command does not match add-on allowlist" }
}
{
  "error": { "code": "COMMAND_FAILED", "message": "Command execution failed" }
}
```

**Example**: *"Set the time to day"*

---

## Safety Mechanisms Summary

| Mechanism | Applies To | Check Point |
|-----------|-----------|-------------|
| Emergency disable | fill_blocks, place_blocks, admin.run_command | Pre-check + per-iteration (fill/placement) |
| Volume limit | fill_blocks | Pre-check (≤ 32768 blocks) |
| Block count limit | place_blocks | Pre-check (≤ 8192 blocks) |
| Protected regions | fill_blocks, place_blocks | Pre-check (AABB overlap) |
| Allowlist | admin.run_command | Pre-check (commandId lookup) |
| Command mismatch | admin.run_command | Pre-check (optional string compare) |
| Cancellation | fill_blocks, place_blocks | Per-iteration (cancelled Set check) |
| Rollback capture | fill_blocks, place_blocks | Per-block (before setType) |
| Idempotency | All mutations | Pre-check (session-level tracker) |
| Expiry | All mutations | Pre-check (isExpired on expiresAt) |
| Busy guard | Session | Pre-tick (skips overlapping ticks) |
| Auth invalidation | Session | Post-request (401/404 → re-handshake with backoff) |

## Fill Generator Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                        startFill()                               │
├──────────────────────────────────────────────────────────────────┤
│  1. Check emergencyDisabled → EMERGENCY_DISABLED                 │
│  2. Check volume ≤ MAX_BUILD_VOLUME → REGION_TOO_LARGE          │
│  3. Check protected region overlap → PROTECTED_REGION            │
│  4. system.runJob(fillGenerator())                               │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    fillGenerator()                                │
├──────────────────────────────────────────────────────────────────┤
│  for x in min.x..max.x:                                         │
│    for y in min.y..max.y:                                       │
│      for z in min.z..max.z:                                     │
│        ┌─────────────────────────────────────────┐               │
│        │ cancelled.has(actionId)?                │──yes──▶ EMIT  │
│        │ emergencyDisabled?                      │──yes──▶ EMIT  │
│        │ block = dimension.getBlock({x,y,z})    │               │
│        │ !block.isValid? → throw                 │               │
│        │ captureRollback? → store position+type  │               │
│        │ block.setType(blockType)                │               │
│        │ completed++                            │               │
│        │ completed % batchSize === 0?           │               │
│        │   → emit "running"                      │               │
│        │   → yield (back to server)              │               │
│        └─────────────────────────────────────────┘               │
│  Loop complete → emit "completed" with rollback metadata         │
└──────────────────────────────────────────────────────────────────┘
```
