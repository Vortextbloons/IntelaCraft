# @intelacraft/shared-protocol

The foundational shared contract for the entire IntelaCraft system. Defines the wire protocol used between the controller, bedrock add-on, AI agent, and webview.

**Zero runtime dependencies.**

## Files

| File | Purpose |
|------|---------|
| `src/constants.ts` | Protocol constants and enumerated string unions |
| `src/types.ts` | TypeScript interfaces for all protocol messages |
| `src/helpers.ts` | Utility functions: parsing, validation, redaction |
| `src/validate.ts` | Runtime validation of every message type |
| `src/factory.ts` | Message construction helpers |
| `src/protocol.test.ts` | Unit tests |

## Constants

| Name | Value | Description |
|------|-------|-------------|
| `PROTOCOL_VERSION` | `"1.0.0"` | Semver string for handshake negotiation |
| `PROTOCOL_MAJOR` | `1` | Major version for compatibility check |
| `MAX_REGION_VOLUME` | `32,768` (32^3) | Max volume for `inspect.region` |
| `MAX_BUILD_VOLUME` | `32,768` (32^3) | Max volume for `world.fill_blocks` |
| `STRONG_BUILD_VOLUME` | `4,096` | Threshold for "strong" risk classification |
| `DEFAULT_BATCH_SIZE` | `512` | Blocks per yield in fill operations |
| `MAX_ROLLBACK_BLOCKS` | `8,192` | Maximum rollback snapshot entries |
| `MAX_PLACE_BLOCKS` | `8,192` | Max individually addressed blocks in one placement |

## AI Modes

| Constant | Value | Description |
|----------|-------|-------------|
| `AI_MODES` | `["ask", "agent"]` | AI capability boundary; independent from permission mode |

```typescript
type AiMode = "ask" | "agent";
```

## Enumerated Types

| Tuple | Values |
|-------|--------|
| `MESSAGE_TYPES` | `handshake`, `handshake_ack`, `poll`, `poll_response`, `action_request`, `operation_event`, `heartbeat`, `error` |
| `RISK_CLASSES` | `read`, `normal`, `strong`, `prohibited` |
| `PERMISSION_MODES` | `observe_only`, `confirm_every_change`, `allow_low_risk`, `builder_region`, `trusted_administrator` |
| `AI_MODES` | `ask`, `agent` |
| `OPERATION_STATES` | `running`, `completed`, `partially_completed`, `failed`, `cancelled` |
| `READ_TOOLS` | `inspect.server_status`, `inspect.players`, `inspect.player`, `inspect.block`, `inspect.region`, `inspect.world_state`, `inspect.entities`, `inspect.scoreboard`, `inspect.tags`, `inspect.heightmap`, `inspect.surface`, `inspect.build_collision`, `inspect.find_empty_area` |
| `MUTATION_TOOLS` | `world.fill_blocks`, `world.place_blocks`, `control.cancel`, `control.emergency_disable`, `admin.run_command` |
| `THINKING_LEVELS` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `DIMENSION_IDS` | `minecraft:overworld`, `minecraft:nether`, `minecraft:the_end` |

## Message Types

All messages extend `MessageEnvelope`:

```typescript
interface MessageEnvelope {
  protocolVersion: string;    // "1.0.0"
  messageType: MessageType;
  requestId: string;          // Unique per-request
  sessionId: string;
  timestamp: string;          // ISO-8601
}
```

### 8 Message Types

| Type | Purpose | Key Fields |
|------|---------|------------|
| `HandshakeMessage` | BDS registers with controller | `serverId`, `clientProtocolVersion`, `capabilities` |
| `HandshakeAckMessage` | Controller accepts/rejects | `acceptedProtocolVersion`, `serverId`, `ok`, `error` |
| `PollMessage` | BDS polls for actions | (bare envelope) |
| `PollResponseMessage` | Controller returns action or null | `action: ActionRequestMessage \| null` |
| `ActionRequestMessage` | Action for BDS to execute | `actionId`, `idempotencyKey`, `toolName`, `arguments`, `actor`, `permissionMode`, `risk`, `approval`, `noApprovalReason`, `expiresAt` |
| `OperationEventMessage` | BDS reports result | `operationId`, `actionId`, `state`, `completedWork`, `totalEstimatedWork` |
| `HeartbeatMessage` | BDS health update | `serverId`, `health: { ok, playerCount, tick, emergencyDisabled }` |
| `ErrorMessage` | Error notification | `error: { code, message, details }` |

## Helper Functions

| Function | Purpose |
|----------|---------|
| `parseProtocolVersion(v)` | Parse semver string, return `{ major, minor, patch }` or null |
| `isProtocolCompatible(v)` | Check major version matches (fail-closed) |
| `currentProtocolVersion()` | Return the current protocol version string |
| `parseVec3i(v)` | Validate integer 3D coordinate |
| `normalizeRegion(a, b)` | Produce inclusive min/max from two corners |
| `parseRegion(v)` | Validate region bounds (accepts `min/max` or `from/to`) |
| `regionVolume(r)` | Compute inclusive volume |
| `isExpired(expiresAt)` | Check if action has expired |
| `createIdempotencyTracker(max)` | Bounded dedup tracker (default 2048 entries) |
| `stableStringify(v)` | Deterministic JSON (sorted keys) |
| `redactSecrets(v)` | Deep redaction of sensitive keys |
| `approvalPayload(action)` | Extract immutable subset for SHA-256 hashing |

## Validation

Every message type has a validator returning `ValidateResult<T>`:

```typescript
type ValidateResult<T> = 
  | { ok: true; value: T } 
  | { ok: false; error: ProtocolErrorBody };
```

### Key Validation Rules

- **Envelope**: Protocol version must be compatible (major match)
- **Action request**: Read tools must have `risk: "read"`, mutations must have `risk: "normal"` or `"strong"`
- **Fill blocks**: Region volume must be ≤ `MAX_BUILD_VOLUME`, block type must match `minecraft:` pattern
- **Entities**: Limit must be 1-128 (default 64)
- **Admin command**: Requires `commandId` string

## Factory Functions

| Function | Returns |
|----------|---------|
| `createEnvelope(type, sessionId, requestId)` | `MessageEnvelope` with protocol version |
| `createHandshake({ sessionId, requestId, serverId, capabilities })` | `HandshakeMessage` |
| `createPoll({ sessionId, requestId })` | `PollMessage` |
| `createHeartbeat({ sessionId, requestId, serverId, health })` | `HeartbeatMessage` |
| `createActionRequest({ ... })` | `ActionRequestMessage` with defaults (5min expiry, confirm_every_change mode) |
| `createOperationEvent({ ... })` | `OperationEventMessage` |
| `newId(prefix)` | Unique ID: `{prefix}_{timestamp_base36}_{seq_base36}` |
