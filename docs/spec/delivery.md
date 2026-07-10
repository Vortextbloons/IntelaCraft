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

- ~~Controller-to-behavior-pack transport and authentication mechanism supported by the target BDS environment.~~ → See [decisions.md](decisions.md) (Phase 1).
- ~~Supported BDS and `@minecraft/server` version matrix.~~ → See [decisions.md](decisions.md) (Phase 1).
- Initial numeric thresholds for block, region, entity, command, rate, and rollback limits (partial: region inspect max 32³ in Phase 1).
- Secure credential-storage mechanism for desktop and hosted deployments.
- Webview host technology and packaging model.
- Persistence database and default audit retention period.
- Exact Pi extension/session isolation mechanism and supported Pi version.
- Initial administrative command allowlist and role model.

## 17. Product Success Definition

IntelaCraft succeeds when an authorized server owner can ask for a meaningful world task, understand exactly what the agent intends to change, approve it with appropriate safeguards, watch it execute without harming server responsiveness, stop it when necessary, and audit the final outcome.
