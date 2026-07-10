# IntelaCraft Product and Technical Specification

**Status:** Draft 1  
**Target:** Minecraft Bedrock Dedicated Server (BDS)  
**Product type:** AI-assisted server control add-on  

## 1. Purpose

IntelaCraft lets an authorized user describe work to perform on a live Minecraft Bedrock server, inspect the AI-generated plan, approve meaningful changes, and monitor safe execution. The system combines a BDS behavior pack, an isolated Pi Coding Agent runtime, direct world-control tools, the user's existing Bedrock Script API MCP, an external controller, and a web interface.

The first complete release must provide a dependable, auditable path from a natural-language request to bounded and validated world changes. An AI prompt is never a security boundary; every operation is validated at the controller and behavior-pack layers.

## 2. Goals and Non-Goals

### 2.1 Goals

- Connect one IntelaCraft instance to one selected BDS server.
- Use a user-selected AI model through an isolated Pi runtime.
- Let the agent inspect players and world state before acting.
- Execute typed, bounded world operations through direct tools.
- Require approval according to configurable risk policies.
- Show plans, approval requests, progress, results, and failures.
- Support cancellation, emergency disable, logging, and practical rollback data.
- Use the Bedrock Script API MCP as an advisory knowledge source.

### 2.2 Non-Goals for the Initial Release

- Autonomous access to servers the user has not explicitly configured.
- Unrestricted shell, filesystem, or arbitrary BDS command access.
- Simultaneous control of multiple BDS servers from one active session.
- A public marketplace for prompts, tools, or models.
- Guaranteed rollback of every Minecraft side effect.
- Replacing normal server administration, backups, or access control.
- Training or fine-tuning AI models.

## 3. Users and Core Use Cases

The primary user is a BDS owner or trusted administrator. Optional future roles include builder, moderator, and observer.

Core use cases:

1. Ask questions about current players, entities, blocks, regions, scores, weather, time, and game rules.
2. Request a structure or terrain modification within an explicitly bounded region.
3. Perform approved administrative actions such as teleporting a player or changing a game rule.
4. Watch a long operation progress in safe batches and cancel it.
5. Review an audit trail showing who requested, approved, and executed each action.

## 4. System Architecture

```text
IntelaCraft Webview
        |
External Controller ---- Isolated Pi Coding Agent
        |                    |             |
        |                    |             +-- Bedrock Script API MCP (advisory)
        |                    +---------------- Direct World Tools
        |
Authenticated transport
        |
BDS Behavior Pack (trusted executor)
        |
Minecraft World
```

### 4.1 Trust Boundaries

- The webview is untrusted for secrets and authorization decisions.
- Model output and Pi tool requests are untrusted input.
- The controller authenticates clients, applies policy, records approvals, validates schemas and limits, and routes requests.
- The behavior pack independently validates every requested operation and is the final authority for world changes.
- The MCP supplies documentation and guidance only; it does not execute world changes.

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

## 6. Shared Protocol

The controller and behavior pack shall share versioned message definitions. Each message includes `protocolVersion`, `messageType`, `requestId`, `sessionId`, and `timestamp`.

An action request additionally includes:

- `actionId` and `idempotencyKey`
- typed `toolName` and `arguments`
- requesting actor and active permission mode
- risk classification
- approval record or an explicit no-approval reason
- expiry time

An operation event includes `operationId`, state, completed work, total estimated work, message, and optional structured error. Supported terminal states are `completed`, `partially_completed`, `failed`, and `cancelled`.

Protocol versions shall be negotiated at connection time. Incompatible major versions must fail closed with a visible diagnostic.

## 7. Approval and Permission Model

### 7.1 Risk Classes

- **Read:** inspection, questions, plan generation, and MCP queries. No approval required.
- **Normal:** building, terrain edits, teleports, entity spawns, inventory changes, allowlisted commands, and game-rule changes. Confirmation required by default.
- **Strong:** large deletion, inventory clearing, mass entity removal, kick/ban operations, destructive commands, server-wide changes, and server stop/reset. Strong confirmation requires an explicit warning and fresh user action; it cannot be remembered globally.
- **Prohibited:** operations outside configured limits, protected-region edits, secret access, arbitrary code execution, and non-allowlisted commands. These cannot be approved from the UI.

Thresholds that promote a normal action to strong risk shall be configurable and enforced by both controller and behavior pack.

### 7.2 Modes

- **Observe Only:** deny every mutation.
- **Confirm Every Change:** require confirmation for every mutation.
- **Allow Low-Risk Actions:** permit explicitly allowlisted low-impact mutations within configured thresholds; confirm others.
- **Builder Region Mode:** permit building only inside one or more assigned regions and deny administrative actions.
- **Trusted Administrator Mode:** permit normal actions without repeated confirmation, but retain strong confirmation and prohibited-action rules.

The safest mode, Confirm Every Change, is the default for a new server profile.

## 8. Task Lifecycle

```text
submitted -> inspecting -> planning -> awaiting_approval -> running
                                                    |          |
                                                    v          v
                                                 rejected   verifying
                                                               |
                         completed | partial | failed | cancelled
```

1. The user submits a request.
2. Pi inspects the minimum necessary world context and optionally queries MCP.
3. Pi creates a plan with estimated impact and structured proposed actions.
4. The controller validates and risk-classifies each action.
5. The webview displays the exact actions requiring approval.
6. After approval, the controller forwards signed/correlated requests.
7. The behavior pack revalidates and executes in safe batches.
8. Pi verifies observable results and reports discrepancies.
9. The UI shows a completion summary and permanent activity record.

Changes to an approved payload invalidate its approval. Large tasks pause for new approval at material checkpoints defined in the displayed plan.

## 9. Building Job Requirements

A building job shall:

- Inspect the target location and dimension.
- Normalize and display its affected bounding box.
- Estimate blocks read, changed, and removed before execution.
- Reject jobs exceeding configured limits rather than silently truncating them.
- Check protected regions and world-height boundaries.
- Divide changes into bounded batches and report progress.
- Be cancellable between batches.
- Record original block states for rollback when enabled and within the rollback budget.
- Identify unsupported blocks or states before execution when practical.
- Verify a representative sample or full bounded result after completion, based on job size.

Rollback is a separate strongly confirmed operation. Its availability, coverage, and expiry must be shown before the original job is approved.

## 10. Model Provider Requirements

The initial provider abstraction shall support OpenAI-compatible endpoints, custom base URLs, API keys, local model servers, hosted providers, saved profiles, optional model discovery, and connection testing. Provider profiles belong only to IntelaCraft.

A connection test shall verify endpoint reachability, authentication, selected-model availability, and the minimum tool-calling capability required by IntelaCraft. Failure must produce an actionable error without logging credentials.

## 11. Security and Reliability Requirements

- Authenticate and integrity-protect controller-to-BDS messages.
- Bind sessions and approvals to a single configured server identity.
- Use least-privilege tool and command allowlists.
- Treat user chat, model output, MCP content, world text, player names, signs, books, and score values as untrusted input.
- Never interpolate untrusted text into a command string.
- Apply replay protection, request expiry, idempotency, and rate limiting.
- Keep credentials outside the webview and behavior pack.
- Record requests, approvals, policy decisions, execution results, and cancellations.
- Provide a controller stop and a behavior-pack emergency-disable state.
- Fail closed when authentication, policy state, protocol compatibility, or approval validity is uncertain.
- Recover from controller/webview disconnects without duplicating an operation.
- Preserve server responsiveness by enforcing per-tick execution budgets.

Administrators remain responsible for normal BDS backups. IntelaCraft shall recommend a recent backup before unusually large or destructive operations.

## 12. Observability and Data Retention

Activity entries shall contain IDs, timestamps, server identity, session/actor, request summary, risk, approval outcome, tool payload with redaction, execution result, and rollback metadata. Logs shall be searchable by task and operation ID. Retention shall be configurable; deletion of history is an explicit administrator action.

Metrics should include connection health, task latency, approval latency, tool failures, blocks processed, cancellation latency, and BDS batch duration. Logs and metrics must not contain credentials or raw secret headers.

## 13. Initial Release Acceptance Criteria

The first complete release is accepted when all of the following are demonstrated:

1. A user can configure and authenticate one BDS server connection and see live health state.
2. A user can configure an OpenAI-compatible or local provider, test it, select a model, and start an isolated Pi session without changing their normal Pi configuration.
3. The MCP can be connected optionally, queried by Pi, and shown as available or unavailable without blocking direct tools.
4. Pi can inspect online players and a bounded region using read-only tools without approval.
5. A bounded build displays its dimension, bounds, estimated block impact, risk, and approval card before any mutation.
6. Approval authorizes only the displayed immutable payload; modified, expired, duplicate, or replayed requests are rejected.
7. An approved build executes in batches, reports progress, respects protected regions and limits, and returns a verifiable result.
8. A user can cancel an active build, after which no new batches start and the UI reports the partial result.
9. Normal and strong-risk sample actions follow their respective confirmation rules in every permission mode.
10. Emergency disable prevents new mutations even if the controller or agent requests them.
11. Every proposed mutation, approval decision, execution result, and cancellation appears in activity history with correlated IDs.
12. API keys and authentication tokens are absent from browser responses, agent transcripts, and logs.
13. Automated tests cover protocol validation, risk classification, approval binding, limits, idempotency, cancellation, and protected-region enforcement.

## 14. Delivery Phases

### Phase 1: Trusted Execution Foundation

- Shared protocol and validation schemas
- Authenticated controller/behavior-pack connection
- Read-only world inspection
- Audit logging and health reporting

### Phase 2: Safe Mutations

- Approval engine and permission modes
- Bounded block/build operations
- Batch progress, cancellation, protected regions, and rollback metadata
- Emergency disable

### Phase 3: Agent and Model Integration

- Isolated Pi runtime
- Provider profiles, model testing, and tool routing
- Optional Bedrock MCP connection
- Planning, verification, and failure recovery

### Phase 4: Product Interface and Hardening

- Polished webview and activity history
- Administrative tool expansion
- End-to-end tests, load tests, security review, and operational documentation

## 15. Repository Structure

```text
intelacraft/
|-- apps/
|   |-- bedrock-addon/       # BDS behavior/resource packs and build tooling
|   `-- webview/             # Future user interface
|-- services/
|   `-- controller/          # Future external controller service
|-- packages/
|   |-- pi-extension/        # Future isolated Pi integration
|   |-- world-tools/         # Future typed direct-world tools
|   |-- mcp-connection/      # Future Bedrock MCP adapter
|   |-- prompts/             # Future versioned agent prompts
|   `-- shared-protocol/     # Future shared schemas and message types
|-- docs/
|   `-- SPEC.md
`-- README.md
```

Only the currently implemented Bedrock add-on is scaffolded. Other component directories should be added when implementation begins so empty placeholders do not imply working functionality.

## 16. Open Decisions

The following must be resolved before their related implementation phase is finalized:

- ~~Controller-to-behavior-pack transport and authentication mechanism supported by the target BDS environment.~~ → See `docs/spec/decisions.md` (Phase 1).
- ~~Supported BDS and `@minecraft/server` version matrix.~~ → See `docs/spec/decisions.md` (Phase 1).
- Initial numeric thresholds for block, region, entity, command, rate, and rollback limits (partial: region inspect max 32³ in Phase 1).
- Secure credential-storage mechanism for desktop and hosted deployments.
- Webview host technology and packaging model.
- Persistence database and default audit retention period.
- Exact Pi extension/session isolation mechanism and supported Pi version.
- Initial administrative command allowlist and role model.

## 17. Product Success Definition

IntelaCraft succeeds when an authorized server owner can ask for a meaningful world task, understand exactly what the agent intends to change, approve it with appropriate safeguards, watch it execute without harming server responsiveness, stop it when necessary, and audit the final outcome.
