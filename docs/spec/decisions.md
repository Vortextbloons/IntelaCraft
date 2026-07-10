# Phase 1 Decisions

Resolved open decisions for the Trusted Execution Foundation phase.

## Transport and authentication

- **Transport:** BDS behavior pack uses outbound HTTP via `@minecraft/server-net`. The pack polls the controller; scripts cannot host a listener.
- **Auth:** Shared bearer token.
  - Controller: `INTELACRAFT_BDS_TOKEN` environment variable.
  - Behavior pack: `@minecraft/server-admin` secret `intelacraft:bds_token` set to the full Authorization header value (`Bearer <token>`), passed as `HttpHeader` so the raw secret is not readable/concatenatable from script.
- **Config:** Controller base URL from server variable `intelacraft:controller_url`. Optional `intelacraft:server_id` identifies the BDS instance.
- **Protocol:** `1.0.0`. Incompatible major versions fail closed at handshake and envelope validation.

## Version matrix (initial)

| Component | Version |
|-----------|---------|
| Minecraft / BDS target | 1.26.33 |
| `@minecraft/server` | `2.9.0-beta.1.26.33-stable` (manifest `2.9.0-beta`) |
| `@minecraft/server-net` | `1.0.0-beta.1.26.33-stable` (manifest `1.0.0-beta`) |
| `@minecraft/server-admin` | `1.0.0-beta.1.26.33-stable` (manifest `1.0.0-beta`) |

## Phase 1 limits

- Read-only tools only (`inspect.*`).
- `inspect.region` max volume: 32³ (`MAX_REGION_VOLUME`).
- Mutations, approvals, Pi, webview, and MCP wiring remain later-phase work.
