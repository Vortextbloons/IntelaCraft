# Phase 4 Decisions

- Webview is a Vite + React SPA in `apps/webview/`, built to static assets and served by the controller on `127.0.0.1` (same origin). The browser stores the bearer token in `sessionStorage` only.
- Activity history uses the existing append-only JSONL audit file plus an in-memory searchable index. Retention is `INTELACRAFT_AUDIT_RETENTION_DAYS`; purge is an explicit authenticated `DELETE /v1/activity`.
- Live operation progress uses SSE at `GET /v1/events/stream`. Task/chat status uses short polling against `/v1/tasks` and `/v1/health`.
- Administrative expansion is pragmatic: `inspect.entities`, `inspect.scoreboard`, `inspect.tags`, and `admin.run_command` with an env/server-variable allowlist (`commandId` only; never free-form command strings from the model or UI). Structures, entity mutations, teleports, and server-state writes remain deferred.
- Permission mode for the webview is controller in-memory settings (`GET`/`PATCH /v1/settings`), defaulting to `confirm_every_change`.
- Task orchestration adds `POST /v1/tasks/:id/approve|reject|cancel`. Approvals bind to the immutable proposed-action payload hash and enqueue through the existing action queue.
