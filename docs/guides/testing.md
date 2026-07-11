# Testing Guide

## Testing Framework

Uses Node.js built-in test runner (`node --test`).

## Test Files

- `packages/shared-protocol/src/protocol.test.ts` - Protocol validation tests
- `packages/pi-extension/src/index.test.ts` - Pi extension tests
- `services/controller/src/app.test.ts` - Route and policy tests
- `services/controller/src/agent.test.ts` - Agent runtime tests
- `services/controller/src/e2e.test.ts` - End-to-end mock BDS tests

## Running Tests

Run all tests:
```powershell
npm test
```

Run specific test:
```powershell
node --test packages/shared-protocol/dist/protocol.test.js
```

## Test Structure

- Uses `node:test` (`describe`, `it`, `beforeEach`)
- Uses `node:assert` for assertions
- Mock HTTP servers for provider testing
- Mock BDS for e2e tests

## Test File Summaries

### `packages/shared-protocol/src/protocol.test.ts`
Protocol validation tests. Covers message schema validation, risk classification (especially `world.fill_blocks` volume thresholds), and type guard functions. Tests are pure—no network or filesystem dependencies.

### `packages/pi-extension/src/index.test.ts`
Pi extension tests. Covers prompt construction, plan normalization (converting raw AI output to structured steps), tool catalog availability, and thinking level configuration. Uses mock HTTP servers to simulate AI provider responses.

### `services/controller/src/app.test.ts`
Route and policy tests. Covers HTTP endpoint handlers, request validation, permission mode behavior, and admin command allowlist logic. Uses mock config objects and verifies response shapes.

### `services/controller/src/agent.test.ts`
Agent runtime tests. Covers Ask/Agent mode validation, read-only inspect auto-run, semantic build preflight, inspection budgeting, verification scheduling, and corrective mutation approval. Key test cases:
- **Ask mode default**: Pi sessions start in read-only Ask mode; mutations and verification steps are rejected.
- **Agent mode approval**: Agent mode allows bounded mutations, queues them after approval, and enforces Ask mode restrictions when switched back.
- **Semantic builds**: `build.wall` triggers preflight collision inspection and materializes `world.place_blocks` before approval.
- **Inspection reuse**: Identical inspection calls are cached; a per-turn budget (8 calls) is enforced.
- **Verification**: One agent verification turn is scheduled after mutation completion; corrective mutations require fresh approval.

### `services/controller/src/e2e.test.ts`
End-to-end mock BDS tests. Simulates a full BDS lifecycle: handshake → poll → execute → events. Uses a mock BDS HTTP server and verifies the complete flow from task creation to action execution.

## Mock Strategies

### Mock HTTP Servers (pi-extension tests)

Tests in `packages/pi-extension` create ephemeral HTTP servers using `node:http` to simulate AI providers:

```typescript
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: '{"steps":[...]}' } }] }));
});
server.listen(0); // Random available port
```

The mock server listens on a random port (`0`) to avoid conflicts. The port is passed to the code under test via config. After each test, the server is closed in `afterEach`.

### Mock BDS (e2e tests)

Tests in `services/controller/src/e2e.test.ts` simulate BDS behavior:

1. **Handshake**: Mock server receives POST `/v1/bds/handshake` and returns a session ID
2. **Poll**: Mock server receives POST `/v1/bds/poll` and returns queued actions
3. **Events**: Mock server receives POST `/v1/bds/events` and logs results

The mock BDS server runs on a random port and is configured to respond with realistic payloads.

### In-Memory State

Tests use `beforeEach` to reset state. The controller creates isolated instances for each test:

```typescript
let controller: Controller;
beforeEach(() => {
  controller = createController({ /* test config */ });
});
```

## Adding New Tests

### Where to Put Tests

| What you're testing | Test file location |
|---------------------|-------------------|
| Protocol validation | `packages/shared-protocol/src/protocol.test.ts` |
| Pi extension logic | `packages/pi-extension/src/index.test.ts` |
| Controller routes | `services/controller/src/app.test.ts` |
| Agent lifecycle | `services/controller/src/agent.test.ts` |
| Full end-to-end flow | `services/controller/src/e2e.test.ts` |

### Naming Conventions

- Test files use `.test.ts` suffix
- Test files are colocated with source files
- `describe` blocks use the module/function name
- `it` blocks use present tense: `"should validate message schema"`

### Import Pattern

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
```

Use `node:assert/strict` (not `node:assert`) for strict equality checks.

## Test Data

### No External Fixtures

Tests do not use external fixture files. All test data is inline:

```typescript
const validMessage = {
  type: "handshake",
  serverId: "test-server",
  version: "1.21.0",
  mods: []
};
```

### Inline Mock Data

Mock responses are defined within test files. This keeps tests self-contained and avoids stale fixture data.

### Generating Test Data

For complex payloads, use factory functions within the test:

```typescript
function makeAction(overrides = {}) {
  return {
    id: "action-uuid",
    type: "fill_blocks",
    tool: "world.fill_blocks",
    args: { from: {x:0,y:0,z:0}, to: {x:1,y:1,z:1}, block: "stone" },
    risk: "normal",
    ...overrides,
  };
}
```

## Writing Tests

1. Import from `node:test` and `node:assert`
2. Use `describe`/`it` blocks
3. Mock external dependencies
4. Test both success and error paths

Example:
```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('Example', () => {
  it('should work', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

## Load Testing

- `scripts/load-smoke.mjs` - Concurrent poll/enqueue smoke test
- Requires running controller

## What to Test

- Protocol validation (shared-protocol)
- Route handlers (controller)
- Policy engine (controller)
- Ask/Agent mode restrictions (agent runtime)
- Read-only inspect auto-run and inspection budgeting (agent runtime)
- Semantic build preflight and materialization (agent runtime)
- Verification scheduling and corrective mutation approval (agent runtime)
- Plan normalization (pi-extension)
- Thinking level clamping and model overrides (pi-extension)