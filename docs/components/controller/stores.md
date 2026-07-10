# Data Stores

All stores live in `src/store.ts` unless otherwise noted. Everything is in-memory with optional persistence.

## SessionStore

Manages BDS server sessions. One active session per `serverId`.

### Key Methods

- **`handshakeUpsert(serverId, meta)`** — Creates or updates a session on handshake. Returns the session.
- **`heartbeat(serverId, patch)`** — Updates player count, tick, emergency status, and `lastSeen` timestamp.
- **`isExpired(session)`** — Returns true if the session has not received a heartbeat within the TTL.
- **`enqueueAction(sessionId, action)`** — Adds an action to the session's queue. Deduplicates by `idempotencyKey`.
- **`dequeueAction(sessionId, actionId)`** — Removes a completed action from the queue.

### Properties

- `sessions: Map<sessionId, Session>`
- `serverToSession: Map<serverId, sessionId>` — Enforces one-session-per-server
- Max sessions: unbounded (one per BDS server)
- Emergency disable flag: per-session boolean that halts all mutations

## EventStore

In-memory ring buffer for operation events broadcast from BDS.

- Max **5,000 events** (oldest evicted on overflow)
- **Pub/sub**: `subscribe(callback)` returns an `unsubscribe` function
- Events are broadcast to **all** subscribers simultaneously
- Used by the SSE streaming endpoint (`/v1/events/stream`)

## SettingsStore

Simple key-value store for runtime settings.

| Setting | Values | Effect |
|---------|--------|--------|
| `permissionMode` | `observe_only`, `allow_low_risk`, `confirm_every_change`, `builder_region`, `trusted_administrator` | Controls approval requirements |
| `thinkingLevel` | `off`, `minimal`, `low`, `medium`, `high` | Controls AI agent reasoning depth |

Changes take effect immediately — no restart required.

## ActivityStore

JSONL-backed append-only activity log (`src/activity.ts`).

- **In-memory cache**: up to 10,000 records
- **Queries**: by `taskId`, `actionId`, `operationId`, `type`, or `since` timestamp
- **Auto-pruning**: based on `INTELACRAFT_AUDIT_RETENTION_DAYS` (default 30)
- **Purge**: `purgeAll()` clears the entire log

## AuditLog

Thin wrapper (`src/audit.ts`) that appends JSONL entries.

- Delegates to `ActivityStore` when available
- All entries are run through `redactSecrets` from `shared-protocol` to strip API keys and tokens

## Provider Persistence

Providers are persisted to a `providers.json` file in the working directory.

```json
{
  "activeProviderId": "provider-1",
  "providers": [
    { "id": "provider-1", "baseUrl": "...", "apiKey": "...", "model": "..." }
  ]
}
```

Hot-swapping is supported: changing the active provider takes effect on the next task without restarting.
