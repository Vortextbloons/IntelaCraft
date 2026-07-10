## 5. Component Requirements

### 5.1 BDS Behavior Pack

The behavior pack shall:

- Use `@minecraft/server-net` for network communication with the controller.
- Expose a versioned request/response protocol to the controller.
- Read permitted world state, including players, entities, blocks, dimensions, scores, tags, weather, time, and selected game rules.
- Execute only allowlisted, schema-valid operations.
- Enforce region, dimension, block-count, entity-count, command, rate, and permission limits independently of the controller.
- Reject stale, duplicate, expired, unauthorized, or malformed requests.
- Process large block operations in configurable per-tick batches to avoid server stalls.
- Return structured progress, success, partial-success, cancellation, and error events.
- Support cancellation at safe batch boundaries.
- Prevent changes inside configured protected regions.
- Capture rollback data for bounded block operations when enabled and feasible.
- Emit optional in-game notifications without exposing secrets.

### 5.2 External Controller

The controller shall:

- Maintain the authenticated BDS connection and surface its health.
- create and manage isolated IntelaCraft Pi sessions;
- Load provider credentials from server-side secure storage or environment configuration.
- Discover and test models where the provider supports it.
- Route tool calls and correlate requests, approvals, operations, and events with unique IDs.
- Validate all inputs against the shared protocol before forwarding them.
- Classify action risk and enforce the active approval mode.
- Ensure an approval applies only to the exact immutable action payload displayed to the user.
- Apply configurable rate, region-size, block-count, entity-count, and execution-time limits.
- Persist append-only activity records with timestamps and actor/session identifiers.
- Cancel active tasks and immediately invoke emergency disable when requested.
- Redact API keys, authentication tokens, and other secrets from logs and model context.

### 5.3 Pi Agent Runtime

The embedded Pi instance shall:

- Use IntelaCraft-specific prompts, sessions, settings, extensions, and storage paths.
- Never modify or depend on the user's normal Pi configuration.
- Inspect relevant world context before proposing a change.
- Use the MCP when Bedrock API knowledge or compatibility guidance is needed.
- Produce a concise plan and structured tool calls rather than embedding commands in prose.
- Respect tool errors, limits, cancellation, and partial completion.
- Verify material changes after execution when a read operation can do so.
- Clearly distinguish planned, approved, running, completed, partial, failed, and cancelled work.

### 5.4 Bedrock Script API MCP

The MCP integration shall be optional and shall expose connection status. It may provide API documentation, compatibility information, supported components and events, architectural patterns, limitations, and debugging guidance. MCP output is untrusted advisory content and cannot bypass direct-tool validation or approval.

### 5.5 Direct World Tools

Every tool shall use a versioned structured input schema and structured result. The initial tool groups are:

- **Inspection:** server status, players, entities, block, region, scoreboard, tags, time, weather, and game rules.
- **World editing:** set/fill blocks and bounded building jobs.
- **Entities and players:** spawn/remove entities and teleport players.
- **Server state:** time, weather, tags, scoreboards, and allowlisted game rules.
- **Structures:** save and load bounded structures where supported.
- **Administration:** a narrowly allowlisted command tool; no arbitrary command string by default.

All mutating calls require an idempotency key, expected target dimension, explicit bounds or targets, and a dry-run estimate when applicable. Coordinates shall use integer `x`, `y`, and `z` fields; regions shall use normalized inclusive minimum and maximum coordinates.

### 5.6 Webview

The webview shall provide:

- AI chat with streaming status and clear task state.
- BDS, controller, model, Pi, and MCP connection indicators.
- Provider profile and model selection with connection testing.
- World-context summaries used by the agent.
- Human-readable plans and action cards showing targets, bounds, estimated impact, risk, and rollback availability.
- Approve, reject, edit-and-replan, cancel, stop, and emergency-disable controls.
- Progress for batch operations and an accessible activity history.
- Permission mode and safety-limit settings.
- A Minecraft-inspired control-panel presentation that remains readable and keyboard accessible.

Secrets shall never be returned to browser code after submission. Sensitive values shall be masked in all UI states.
