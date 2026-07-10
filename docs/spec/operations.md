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
