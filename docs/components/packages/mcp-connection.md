# @intelacraft/mcp-connection

An optional advisory MCP (Model Context Protocol) client. Provides a thin HTTP wrapper for querying an external MCP server.

**Zero runtime dependencies.**

## Design Principle

The MCP client is **advisory only** — it never throws and returns `null` on any failure. The system degrades gracefully if MCP is unavailable.

## AdvisoryMcpClient

### Constructor

```typescript
new AdvisoryMcpClient(url?: string, token?: string)
```

- `url` — MCP server URL (if unset, client is disabled)
- `token` — Optional auth token

### status()

```typescript
status(): { configured: boolean; available: boolean; advisoryOnly: true }
```

Returns whether MCP is configured and available. Always reports `advisoryOnly: true`.

### query(question)

```typescript
query(question: string): Promise<unknown | null>
```

Sends a JSON-RPC 2.0 `tools/call` request to the MCP server's `search` tool.

**Request format**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search",
    "arguments": { "query": "<question>" }
  }
}
```

**Returns**: The parsed JSON response from MCP, or `null` if:
- URL is not configured
- Request fails (network error, timeout)
- Response is not OK
- Any error occurs

**Timeout**: 15 seconds.

## Integration

In `services/controller/src/agent.ts`:

1. `AdvisoryMcpClient` is created in `AgentRuntime` constructor with optional URL/token
2. During task creation, if `useMcp !== false`, calls `this.mcp.query(request)`
3. The response is wrapped in `<untrusted_mcp_advice>` tags via `wrapUntrusted()`
4. Injected into the planning prompt as untrusted context
5. The AI model treats it as data, not instructions

## Graceful Degradation

If MCP is unavailable:
- Planning continues without advisory context
- No error is surfaced to the user
- The `ConnectionStrip` webview component shows MCP as "off" (gray dot)
- Status is available via `GET /v1/mcp/status`
