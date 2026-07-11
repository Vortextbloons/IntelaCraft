# Data Stores

All stores live in `src/store.ts` unless otherwise noted. Everything is in-memory with optional persistence.

## SessionStore

Manages BDS server sessions. One active session per `serverId`.

### Key Methods

- **`upsertSession(session)`** — Creates or updates a BdsSession on handshake. Replaces any existing session for the same `serverId`.
- **`touchHeartbeat(sessionId, health)`** — Updates `lastHeartbeatAt` and `lastHealth` from a BDS heartbeat. Returns false if session unknown.
- **`getSession(sessionId)`** — Returns the session by ID.
- **`getSessionByServer(serverId)`** — Returns the session for a given server ID.
- **`enqueue(sessionId, action)`** — Adds an action to the session's queue. Deduplicates by `idempotencyKey`. Rejects expired actions.
- **`dequeue(sessionId)`** — Returns the next non-expired, non-emergency-blocked action from the queue. Skips mutations when emergency is disabled.
- **`setEmergencyDisabled(sessionId, value)`** — Toggles the emergency disable flag for a session.
- **`isEmergencyDisabled(sessionId)`** — Returns true if the session has emergency disable active.
- **`listSessions()`** — Returns all active sessions.

### Properties

- `sessions: Map<string, BdsSession>` — keyed by sessionId
- `sessionsByServer: Map<string, string>` — serverId → sessionId, enforces one-session-per-server
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
| `thinkingLevel` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | Controls AI agent reasoning depth |

The store exposes `preferredThinkingLevel` (user-set) and `thinkingLevel` (effective, may differ if Pi SDK overrides). Changes take effect immediately — no restart required.

## ActivityStore

JSONL-backed append-only activity log (`src/activity.ts`).

- **In-memory cache**: up to 10,000 records
- **Queries**: by `taskId`, `actionId`, `operationId`, `type`, or `since` timestamp
- **Auto-pruning**: based on `INTELACRAFT_AUDIT_RETENTION_DAYS` (default 30)
- **Purge**: `purgeAll()` clears the entire log
- **Async writes**: File appends and purges use a serialized write queue (`writeQueue`) backed by `fs/promises` to avoid blocking the event loop. Errors are logged to console but do not crash the process.

## AuditLog

Thin wrapper (`src/audit.ts`) that appends JSONL entries.

- Delegates to `ActivityStore` when available
- All entries are run through `redactSecrets` from `shared-protocol` to strip API keys and tokens
- **Async writes**: Uses a serialized write queue (`writeQueue`) backed by `fs/promises` for non-blocking JSONL appends. Errors are logged to console but do not crash the process.

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
