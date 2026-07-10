# Phase 3 Decisions

- Provider profiles use OpenAI-compatible `/models` and `/chat/completions` endpoints. Credentials remain server-side and public profile responses expose only `apiKeyConfigured`.
- Every session embeds the official `@earendil-works/pi-coding-agent` SDK with dedicated auth, model registry, resource loader, system prompt, and JSONL session storage beneath `INTELACRAFT_PI_STORAGE_PATH`. Built-in filesystem and shell tools are disabled, and the runtime never reads the user's normal Pi configuration.
- Plans are strict JSON containing inspection, action, and verification stages. Inspection and verification are restricted to validated read-only tools; proposed actions pass the same protocol and policy validation used for direct calls.
- World context and MCP advice are recursively secret-redacted before entering model context.
- The Bedrock MCP adapter is optional HTTP JSON-RPC, status-visible, and advisory-only. Unavailability fails only MCP-assisted planning, not direct world tools.
- Provider/model failures and malformed plans become explicit failed task states with actionable messages. Mutations remain in `awaiting_approval` until routed through the Phase 2 immutable approval API.
