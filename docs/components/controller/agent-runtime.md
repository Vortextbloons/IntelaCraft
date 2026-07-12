# Agent Runtime

Whole-structure planning binds `build_compile` to the active task. Successful compilation stores the validated specification, canonical expected state, optimized phases, warnings, and SHA-256 payload hash as `pendingCompiledBuild`. Public task responses omit full block arrays and executable operations. Compilation never bypasses approval or directly queues BDS mutations.

The final plan references that state with one `build.compiled` action containing the controller-issued build ID and payload hash. Materialization rejects stale IDs and altered hashes, recomputes the hash from stored state, and expands only controller-owned phase operations. Each resulting protocol action is independently validated and approved through the existing controller policy path.

Compiled actions execute one non-empty phase at a time. The next phase is approved and queued only after all actions in its dependency phase complete; a failed required phase marks the task failed and leaves dependent phases unqueued. After the final phase, the controller automatically queues `inspect.voxel_snapshot`, compares it with stored expected state, persists `BuildVerification`, and completes the task only at 100 percent. Mismatches produce a partial result and never trigger an unapproved mutation.

When deterministic verification finds mismatches, the controller may materialize one bounded minimal repair set. It increments the repair-pass guard and returns to `awaiting_approval`; it never queues the repair automatically. `build_modify` accepts only allowlisted BuildSpec fields and feature changes, then validates and recompiles into a new controller ID and hash.

At 100-percent deterministic verification, multi-phase compiled builds are automatically saved once when storage is below the configured limit. Explicit `build_save` supports user-selected pending builds and is idempotent per task.

The AI agent runtime (`src/agent/`, ~1,800 lines total) is the most complex component. It manages the full task lifecycle from natural language input to world mutation. The code is organized into a modular directory structure with clear separation of concerns.

## Overview

1. User submits a natural language task (in Ask or Agent mode)
2. Agent builds world context and chat history
3. AI model plans a sequence of tool calls
4. In **Agent mode**: inspection wave runs, model replans, user approves mutations, mutations execute, verification confirms
5. In **Ask mode**: only inspection (read-only) actions are allowed; mutations and verification are rejected by `validatePlanTools()`

## Module Architecture

The agent is decomposed into focused modules under `src/agent/`:

```
src/agent/
├── types.ts                 # All shared types (AgentTaskState, AgentTask, AgentContext, etc.)
├── runtime.ts               # AgentRuntime facade — implements AgentContext, delegates to pure functions
├── task-store.ts            # Task persistence and CRUD
├── provider-store.ts        # Provider persistence, CRUD, model discovery
├── chat-history.ts          # Chat history resolution and append
├── sanitize.ts              # Deterministic JSON serialization, API key sanitization
├── lifecycle/
│   ├── approve.ts           # approveTask — payload hashing, auto-enqueue reads
│   ├── cancel.ts            # cancelTask — removes queued actions, enqueues control.cancel
│   ├── reject.ts            # rejectTask — state transition to rejected
│   └── operations.ts        # onOperationEvent — per-task promise chain, state machine driver
├── planning/
│   ├── planner.ts           # createTaskInternal, continueTask, planWithValidationRetry
│   └── replan.ts            # scheduleAgentVerification, verifyAfterMutations, replanAfterInspection, editAndReplan
└── inspection/
    ├── bridge.ts            # createBoundedInspectionExecutor — rate-limiting, caching, 30s timeout
    └── materialize.ts       # buildWorldContext, materializeAction, validatePlanTools, applyPlanToTask
```

### Design Patterns

- **Facade**: `AgentRuntime` (`agent/runtime.ts`) is a thin facade that implements `AgentContext` and delegates to pure functions in the sub-modules. It owns the mutable state but all business logic lives in the lifecycle/planning/inspection modules.
- **AgentContext interface**: The shared mutable interface (`agent/types.ts`) defines the contract that all modules operate against. `AgentRuntime` is the sole implementation.
- **Pure function delegation**: Lifecycle methods (`approveTask`, `cancelTask`, `rejectTask`), planning functions, and inspection functions are all pure or near-pure, taking `AgentContext` as input.

## Ask vs Agent Mode

Every task has a `mode` field (`AiMode` from `shared-protocol`) that controls what the agent is allowed to plan:

| Mode | Allowed | Use Case |
|------|---------|----------|
| `ask` (default) | Read-only inspections only | Questions, world queries, planning previews |
| `agent` | Inspections + mutations + verification | Building, editing, world changes |

### Enforcement

- `validatePlanTools(plan, mode)` in `agent/inspection/materialize.ts` rejects plans containing `actions` or `verification` steps when `mode === "ask"`
- The mode is passed through to all planning calls (`planWithValidationRetry`, `continueTask`, `replanAfterInspection` in `agent/planning/`)
- Pi sessions are tagged with `s.mode = task.mode` so the model knows the constraint
- The webview/task API accepts `mode` on `POST /v1/tasks`, `POST /v1/tasks/stream`, and `POST /v1/tasks/:id/stream`

### Default

Mode defaults to `"ask"` when not specified by the client. This ensures new tasks are read-only unless explicitly opted into mutation mode.

## AgentTask Interface

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique task identifier |
| `state` | AgentTaskState | Current lifecycle state |
| `request` | string | Original user prompt |
| `bdsSessionId` | string | Target BDS session |
| `piSessionId` | string | Active Pi session ID |
| `mode` | AiMode | `"ask"` or `"agent"` — controls allowed plan actions |
| `proposedActions` | ActionRequestMessage[] | Mutations awaiting approval (or inspect-only actions once materialized) |
| `pendingReads` | ActionRequestMessage[] | Read-only inspection actions auto-enqueued without approval |
| `pendingVerification` | ActionRequestMessage[] | Verification reads to run after mutations |
| `completedActionIds` | string[] | Dedup set for completed actions |
| `plan` | AgentPlan \| undefined | The current or last plan |
| `preview` | BuildPreview \| undefined | Construction preview (blocks, batches, materials, warnings) |
| `worldSnapshot` | WorldSnapshot \| undefined | Live collision data from inspect.build_collision |
| `error` | string \| undefined | Error message if failed |
| `createdAt` | string | Creation timestamp (ISO 8601) |
| `updatedAt` | string | Last update timestamp (ISO 8601) |
| `metrics` | object \| undefined | Plan latency, validation retries, inspection stats |
| `awaitingInspectReplan` | boolean \| undefined | True when mutations deferred until inspect completes + replan |
| `agentVerificationStarted` | boolean \| undefined | Guards the single post-mutation agent verification turn |

## Task State Machine

```
submitted → planning → inspecting → awaiting_approval → planned → running → verifying → completed
```

### Terminal States

- `completed` — all actions executed and verified
- `failed` — unrecoverable error
- `cancelled` — user or system cancelled
- `rejected` — user rejected the plan
- `partial` — task ended with some actions incomplete (e.g. controller restart, verification without evidence)

### Key Transition

- `inspecting` → `planning` — via `replanAfterInspection()` when inspection results are available

## Provider Management

Provider CRUD and persistence lives in `agent/provider-store.ts`:

- **CRUD**: `saveProvider`, `listProviders`, `getActiveProvider`, `setActiveProvider`
- **Persistence**: `providers.json` file (debounced writes)
- **`sanitizeApiKey`**: strips `Bearer` prefix, rejects browser extension error messages, validates printable ASCII only (in `agent/sanitize.ts`)
- **`needProvider`**: ensures at least one provider exists, throws descriptive error if not
- **`testProviderById`**: tests provider connectivity
- **`modelsForProvider`**: discovers available models for a provider
- **Constructor**: Creates provider and task directories (`mkdirSync`) on startup if they don't exist

## Session Management

- `createPiSession` + `initializePiSession` — bootstraps a pi-extension runtime session
- In-memory `Map<sessionId, PiSession>` of active sessions
- `disposePiSession` — cleanup on task completion or error

## Task Creation Flow (`createTaskInternal` in `agent/planning/planner.ts`)

1. Create `AgentTask` with state `submitted`, `mode` defaults to `"ask"`
2. Tag Pi session with `s.mode = task.mode`
3. MCP advisory query (optional, untrusted context injection)
4. Provider hot-swap if the user changed providers
5. Build world context: server health, player count, admin command IDs
6. Resolve chat history: stored turns + client-provided context
7. `planWithValidationRetry` (up to 2 attempts)
8. `applyPlanToTask` — materialize actions, set state
9. Enqueue pending reads (inspection actions)

## Task Persistence (`agent/task-store.ts`)

Tasks are persisted to a `tasks.json` file using **debounced async writes**:

- **Debounce**: 50ms timer batches rapid changes (e.g. multiple state transitions) into a single write
- **Async**: Uses `fs/promises` `writeFile` to avoid blocking the event loop
- **In-flight guard**: If a write is already in progress, the next write is queued and will execute after the current one completes
- **Error handling**: Write failures are logged to console but do not crash the process
- **Triggers**: Tasks are persisted on creation (`createTaskInternal`), deletion (`deleteTask`), and state changes via `publicTask`

This replaces the previous synchronous `writeFileSync` approach which could block the event loop during concurrent task operations.

## Planning with Validation Retry (`agent/planning/planner.ts`)

1. Bind `InspectionExecutor` for live BDS bridge
2. Call `planWithPiSession` (pi-extension's main planning function)
3. `validatePlanTools(plan, mode)` — enforces mode constraints:
   - In **Ask mode**: rejects any plan with non-empty `actions` or `verification` arrays
   - In all modes: all inspection/verification steps must use `inspect.*` tools
4. **Build validation** — semantic build steps (`build.*`) are validated via `validateBuildPlan()` from the construction package (checks step IDs, dependencies, circular refs, geometry, volume limits, protected regions)
5. Dry-run `materializeAction` to validate arguments
6. **Retry once** on validation failure with error context injected into the next attempt

## Semantic Build Conversion

When materializing actions (in `agent/inspection/materialize.ts`), steps with `toolName.startsWith("build.")` are automatically converted:

1. `generateSemantic(toolName, args)` from `@intelacraft/construction` produces a `GeneratedBuild` (dimension + `BlockPlacement[]` + bounds)
2. The action is materialized as `world.place_blocks` with the generated block array
3. `inspect.build_collision` actions are auto-added for each semantic build's bounding box
4. `previewPlacements()` analyzes the combined builds for cost, conflicts, and warnings
5. The preview is stored on `task.preview` for the webview to display

### worldSnapshot

When `inspect.build_collision` results arrive via `onOperationEvent` (in `agent/lifecycle/operations.ts`), the controller captures a `WorldSnapshot` (stored via `updateWorldSnapshotFromCollision` in `agent/inspection/materialize.ts`):

```typescript
interface WorldSnapshot {
  capturedAt: string;
  dimension: DimensionId;
  collisions: Array<{ position?: Vec3i; type: string }>;
  protectedRegions: Array<{ dimension: string; region: RegionBounds }>;
}
```

This snapshot is passed to `previewPlacements()` to account for live world state when estimating build cost.

## Live Inspection Execution (`agent/inspection/bridge.ts`)

`executePiInspection(action)` (bounded executor with rate-limiting + caching):
1. Materialize the action
2. Enqueue on the target `SessionStore`
3. Wait for BDS response via `inspectionWaiters` Map
4. 30-second timeout per inspection
5. Resolves when `onOperationEvent` fires with a terminal state

## Inspection-Replan Flow (`agent/planning/replan.ts`)

When a plan contains both inspection and mutation actions:
1. Mutations are **deferred**
2. Inspection wave runs first
3. `replanAfterInspection()` sends: _"Inspection finished... propose final mutation plan"_
4. Model sees fresh tool results via `injectPiToolResult`
5. New plan contains only mutations

## Task Lifecycle Methods

### `approveTask(taskId)` — `agent/lifecycle/approve.ts`
1. Create `ApprovalRecord` with SHA-256 hash of the action payload
2. Check emergency disable flag on the session
3. Enqueue all approved mutations
4. Auto-enqueue read-only inspection actions

### `rejectTask(taskId)` — `agent/lifecycle/reject.ts`
Sets task state to `rejected`, discards the plan.

### `cancelTask(taskId)` — `agent/lifecycle/cancel.ts`
Removes queued actions from the session queue. Enqueues `control.cancel` for every enqueued action.

### `editAndReplan(taskId, editedInput)` — `agent/planning/replan.ts`
Allows the user to modify the prompt and re-run planning.

## Operation Event Processing (`agent/lifecycle/operations.ts`)

- Serial operation event queues per task (`operationEventQueues` Map)
- Inspection waiter resolution (unblocks `executePiInspection`)
- Deduplication via `completedActionIds` Set
- State transitions based on completion of inspect/mutation/verify waves

## Chat History (`agent/chat-history.ts`)

- `resolveHistory(taskId)` — loads stored history for a task
- `appendHistory(taskId, messages)` — persists new turns
- Max **32 turns** retained per task
- Individual messages truncated to **4,000 characters**

## MCP Integration

`AdvisoryMcpClient.query()` injects untrusted context from the MCP server into the planning prompt. The model treats this as advisory information, not ground truth.

## Thinking Levels

Controls the AI model's reasoning depth. Passed directly to the Pi SDK.

| Level | Effect |
|-------|--------|
| `off` | No chain-of-thought |
| `minimal` | Brief reasoning |
| `low` | Light reasoning |
| `medium` | Moderate reasoning |
| `high` | Deep reasoning (slower, more thorough) |
| `xhigh` | Extended reasoning |
| `max` | Maximum reasoning budget |
