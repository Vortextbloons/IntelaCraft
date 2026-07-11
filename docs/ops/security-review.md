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

## AI Modes Detail

AI mode is a capability boundary independent from permission mode. It controls whether the AI agent can propose mutations at all.

| Mode | Behavior | Security Implication |
|------|----------|----------------------|
| `ask` | Read-only. The agent inspects the world and answers questions but cannot plan or execute any mutations. Plans with actions or verification steps are rejected at validation. | Safest mode. Use for exploration, auditing, or when you want zero mutation risk. Default mode for new tasks. |
| `agent` | Full planning. The agent can inspect, plan mutations, and propose builds or admin commands. Mutations still subject to permission mode and risk classification. | Standard operating mode. Mutations require approval unless permission mode auto-approves them. |

AI mode is enforced at plan validation (`validatePlanTools`) — the controller rejects any plan containing actions or verification steps when in `ask` mode. The default for new tasks is `ask`.

## Permission Modes Detail

| Mode | Behavior |
|------|----------|
| `observe_only` | Blocks all mutations. Only inspect tools work. Safe for read-only exploration. |
| `confirm_every_change` | Every mutation requires explicit user approval before execution. |
| `allow_low_risk` | `read` and `normal` risk actions are auto-approved. `strong` risk actions still require approval. |
| `builder_region` | Builds are restricted to configured builder regions. Out-of-region mutations require approval. |
| `trusted_administrator` | All mutations are trusted and auto-approved. **Dangerous** — use only in fully controlled environments. |

## Risk Classification Detail

| Risk | Examples | Approval |
|------|----------|----------|
| `read` | Inspection tools (inspect, query) | Always safe, never blocked |
| `normal` | Small fills, allowed admin commands | Auto-approved in `allow_low_risk` mode |
| `strong` | Large fills (>4096 blocks), emergency disable, air fills in any region | Requires approval in all modes except `trusted_administrator` |
| `prohibited` | Fills exceeding 32,768 blocks, overlapping protected regions, unknown admin commands | Never allowed regardless of mode |

## Safety Mechanisms

- **Protected regions** — Configurable regions where builds are blocked or restricted.
- **Volume limits** — Single operations capped at 32,768 blocks.
- **Batch yielding** — Large builds are chunked at 512 blocks per tick to avoid server freezes.
- **Emergency disable** — Global kill switch that blocks all mutations until explicitly re-enabled. Classified as `strong` risk.
- **Approval binding** — SHA-256 hash binds action ID, idempotency key, tool, arguments, actor, mode, risk, and expiry. Rejects mismatched or stale approvals.
- **Idempotency tracking** — Each action has a unique idempotency key; duplicate execution is rejected.
- **Action expiry** — Approvals are time-limited and expire if not executed within the validity window.
- **Admin command allowlist** — Only pre-approved `commandId` values can execute via the admin tool.

## Threat Model

| Vector | Exposure | Mitigation |
|--------|----------|------------|
| Localhost-only | Controller binds to `127.0.0.1`; not network-exposed | No additional network controls in Phase 4 |
| Shared bearer token | Full admin access on localhost | Token shared between BDS, CLI, and webview; no role separation |
| AI agent | Semi-trusted; can inspect freely, needs approval for mutations | Risk classification + approval binding enforce human-in-the-loop |
| AI mode (`ask`) | Read-only boundary; agent cannot plan or execute mutations | Plan validation rejects any plan with actions/verification when in ask mode |
| MCP advisory | Untrusted; can suggest plans but cannot bypass tool restrictions | Plans validated before execution |
| No rate limiting | Open to abuse if token is compromised | Not yet addressed (open decision) |
| JSONL audit | Not tamper-evident; append-only file | Copy before purging; consider integrity hashing for production |

## Residual risks

- Shared bearer token is equivalent to full admin access on localhost.
- JSONL audit is not tamper-evident.
- No rate limiting yet (open decision).
- SSE and static UI assume localhost; do not expose the controller to the network without additional controls.
