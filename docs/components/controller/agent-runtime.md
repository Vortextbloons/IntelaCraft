# Agent Runtime

The AI agent runtime (`src/agent.ts`, ~1,287 lines) is the most complex component. It manages the full task lifecycle from natural language input to world mutation.

## Overview

1. User submits a natural language task
2. Agent builds world context and chat history
3. AI model plans a sequence of tool calls
4. Inspection wave runs (reads world state via BDS)
5. Model replans with fresh inspection results
6. User approves the final mutation plan
7. Mutations execute on BDS
8. Verification wave confirms results

## AgentTask Interface

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique task identifier |
| `state` | TaskState | Current lifecycle state |
| `input` | string | Original user prompt |
| `serverId` | string | Target BDS server |
| `sessionId` | string | Active session ID |
| `actions` | Action[] | Materialized actions to execute |
| `pendingActions` | Action[] | Actions awaiting approval |
| `completedActionIds` | Set<string> | Dedup set for completed actions |
| `approvalRecord` | ApprovalRecord \| null | SHA-256 approval binding |
| `history` | ChatMessage[] | Conversation history |
| `error` | string \| null | Error message if failed |
| `createdAt` | number | Creation timestamp |
| `updatedAt` | number | Last update timestamp |
| `preview` | BuildPreview \| null | Construction preview (blocks, batches, materials, warnings) |
| `worldSnapshot` | WorldSnapshot \| null | Live collision data from inspect.build_collision |

## Task State Machine

```
submitted → planning → inspecting → awaiting_approval → planned → running → verifying → completed
```

### Terminal States

- `completed` — all actions executed and verified
- `failed` — unrecoverable error
- `cancelled` — user or system cancelled
- `rejected` — user rejected the plan

### Key Transition

- `inspecting` → `planning` — via `replanAfterInspection()` when inspection results are available

## Provider Management

- **CRUD**: create, read, update, delete provider profiles (`baseUrl`, `apiKey`, `model`)
- **Persistence**: `providers.json` file
- **`sanitizeApiKey`**: strips `Bearer` prefix, rejects browser extension error messages, validates printable ASCII only
- **Hot-swap**: `refreshPiSessionProvider()` swaps the active provider on a live session without restart

## Session Management

- `createPiSession` + `initializePiSession` — bootstraps a pi-extension runtime session
- In-memory `Map<sessionId, PiSession>` of active sessions
- `disposePiSession` — cleanup on task completion or error

## Task Creation Flow (`createTaskInternal`)

1. Create `AgentTask` with state `submitted`
2. MCP advisory query (optional, untrusted context injection)
3. Provider hot-swap if the user changed providers
4. Build world context: server health, player count, admin command IDs
5. Resolve chat history: stored turns + client-provided context
6. `planWithValidationRetry` (up to 2 attempts)
7. `applyPlanToTask` — materialize actions, set state
8. Enqueue pending reads (inspection actions)

## Planning with Validation Retry

1. Bind `InspectionExecutor` for live BDS bridge
2. Call `planWithPiSession` (pi-extension's main planning function)
3. `validatePlanTools` — all inspection/verification actions must use `inspect.*` tools
4. **Build validation** — semantic build steps (`build.*`) are validated via `validateBuildPlan()` from the construction package (checks step IDs, dependencies, circular refs, geometry, volume limits, protected regions)
5. Dry-run `materializeAction` to validate arguments
6. **Retry once** on validation failure with error context injected into the next attempt

## Semantic Build Conversion

When materializing actions, steps with `toolName.startsWith("build.")` are automatically converted:

1. `generateSemantic(toolName, args)` from `@intelacraft/construction` produces a `GeneratedBuild` (dimension + `BlockPlacement[]` + bounds)
2. The action is materialized as `world.place_blocks` with the generated block array
3. `inspect.build_collision` actions are auto-added for each semantic build's bounding box
4. `previewPlacements()` analyzes the combined builds for cost, conflicts, and warnings
5. The preview is stored on `task.preview` for the webview to display

### worldSnapshot

When `inspect.build_collision` results arrive via `onOperationEvent`, the controller captures a `WorldSnapshot`:

```typescript
interface WorldSnapshot {
  capturedAt: string;
  dimension: DimensionId;
  collisions: Array<{ position?: Vec3i; type: string }>;
  protectedRegions: Array<{ dimension: string; region: RegionBounds }>;
}
```

This snapshot is passed to `previewPlacements()` to account for live world state when estimating build cost.

## Live Inspection Execution

`executePiInspection(action)`:
1. Materialize the action
2. Enqueue on the target `SessionStore`
3. Wait for BDS response via `inspectionWaiters` Map
4. 30-second timeout per inspection
5. Resolves when `onOperationEvent` fires with a terminal state

## Inspection-Replan Flow

When a plan contains both inspection and mutation actions:
1. Mutations are **deferred**
2. Inspection wave runs first
3. `replanAfterInspection()` sends: _"Inspection finished... propose final mutation plan"_
4. Model sees fresh tool results via `injectPiToolResult`
5. New plan contains only mutations

## Task Lifecycle Methods

### `approveTask(taskId)`
1. Create `ApprovalRecord` with SHA-256 hash of the action payload
2. Check emergency disable flag on the session
3. Enqueue all approved mutations

### `rejectTask(taskId)`
Sets task state to `rejected`, discards the plan.

### `cancelTask(taskId)`
Sends `control.cancel` for **every** enqueued action on the session.

### `editAndReplan(taskId, editedInput)`
Allows the user to modify the prompt and re-run planning.

## Operation Event Processing (`processOperationEvent`)

- Serial operation event queues per task (`operationEventQueues` Map)
- Inspection waiter resolution (unblocks `executePiInspection`)
- Deduplication via `completedActionIds` Set
- State transitions based on completion of inspect/mutation/verify waves

## Chat History

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
