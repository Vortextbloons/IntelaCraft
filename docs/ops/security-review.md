# Phase 4 Security Review

## Trust boundaries

| Boundary | Trust | Notes |
|----------|-------|-------|
| Webview (browser) | Untrusted | Same-origin to localhost controller; bearer in sessionStorage; never receives API keys after submit |
| Controller | Trusted | Validates protocol, policy, approvals, admin allowlist |
| Behavior pack | Semi-trusted | Independent revalidation, protected regions, emergency disable, admin allowlist |
| Pi / model / MCP | Untrusted advisory | Plans validated; MCP cannot bypass tools |

## Auth

- Single shared bearer token (`INTELACRAFT_BDS_TOKEN`) for BDS, CLI, and webview.
- Controller binds to `127.0.0.1` only.
- No separate role model in Phase 4.

## Secrets

- Provider API keys stay server-side; public profiles expose `apiKeyConfigured` only.
- Audit and activity records pass through `redactSecrets`.
- Admin tool never accepts free-form command strings from the UI/model — only allowlisted `commandId`.

## Approval binding

- SHA-256 payload hash binds action ID, idempotency key, tool, arguments, actor, mode, risk, and expiry.
- Task approve endpoint re-hashes proposed actions and rejects mismatch/stale approvals.
- Emergency disable rejects new mutations independently on controller and add-on.

## Residual risks

- Shared bearer token is equivalent to full admin access on localhost.
- JSONL audit is not tamper-evident.
- No rate limiting yet (open decision).
- SSE and static UI assume localhost; do not expose the controller to the network without additional controls.
