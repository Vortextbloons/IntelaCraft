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
