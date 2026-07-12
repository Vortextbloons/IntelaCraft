# Troubleshooting Guide

Common issues and solutions for IntelaCraft.

## 1. Controller Won't Start

### Port already in use
Change the port in your `.env` file:
```
PORT=8788
```

### Missing .env
Run the setup script to generate a default `.env`:
```bash
npm run setup
```

### Build errors
Run the build and check for errors:
```bash
npm run build
```
Fix any reported TypeScript or compilation errors.

### Missing dependencies
Install all dependencies:
```bash
npm install
```

## 2. Webview Shows "Disconnected"

### Controller not running
Start the controller:
```bash
npm run dev
```

### Wrong bearer token
Enter the matching `INTELACRAFT_BDS_TOKEN` in the webview connection settings.

### CORS issues
Access the webview at `http://127.0.0.1:8787` — do not use `0.0.0.0`.

## 3. BDS Addon Not Connecting

### Wrong controller URL
Check `intelacraft:controller_url` in the BDS config matches the controller address.

### Wrong token
Verify `intelacraft:bds_token` matches `INTELACRAFT_BDS_TOKEN` in the controller `.env`.

### BDS not started
Start BDS with the addon enabled. Check the server console for `[IntelaCraft]` prefixed messages.

## 4. Actions Not Executing

### Emergency disable active
Check the webview connection strip. Disable via:
```
POST /v1/emergency-disable  (set enabled: false)
```

### AI mode is "ask" (read-only)
If the AI agent is in `ask` mode, it cannot plan or execute any mutations — only inspect. The controller rejects plans with actions:
```
Ask mode is read-only: actions and verification must be empty
```
Switch to `agent` mode when creating the task, or use the mode selector in the webview. The default mode for new tasks is `ask`.

### Permission mode too restrictive
Switch to `allow_low_risk` or `trusted_administrator` in webview settings.

### Protected region
Check if target blocks are inside a protected region. Actions targeting protected regions are blocked.

### Action expired
Actions have expiry timestamps. If expired, resubmit the action.

### Volume too large
Max 32,768 blocks per fill. Break large operations into smaller regions.

## 5. AI Agent Not Responding

### No provider configured
Add a provider via the webview or:
```
POST /v1/providers
```

### Provider test failed
Test the provider connection:
```
POST /v1/providers/:id/test
```

### Model not available
Discover available models:
```
POST /v1/providers/:id/models
```

### Pi session failed
Check controller logs for session errors.

## 6. Build Failures

### TypeScript errors
Run the type checker:
```bash
npm run typecheck
```

### Missing @minecraft/* types
These types are provided by the BDS runtime, not npm. Ensure your IDE resolves them from the BDS installation.

### esbuild errors
Check `apps/bedrock-addon/src/` for syntax issues.

## 7. Test Failures

### Stale build
Run the build before tests:
```bash
npm run build
```

### Port conflicts
Tests may need ports. Kill other processes using the expected ports.

### Mock server issues
Tests use mock HTTP servers. Check for port conflicts or leftover processes.

## 8. Common Error Messages

| Message | Meaning |
|---------|---------|
| `Protocol version incompatible` | BDS addon and controller versions mismatch |
| `Action expired` | Action was queued but not executed in time |
| `Protected region` | Target blocks are in a protected region |
| `Emergency disable active` | Emergency stop is toggled on |
| `Approval required` | Permission mode requires user approval |
| `Ask mode is read-only` | AI agent is in ask mode; switch to agent mode to plan mutations |

## 9. Logging and Diagnostics

### Controller logs
View console output from `npm run dev`.

### BDS logs
Check the BDS server console for `[IntelaCraft]` prefixed messages.

### Audit log
JSONL file at `INTELACRAFT_AUDIT_PATH` contains all executed actions.

### Activity
Query activity with filters:
```
GET /v1/activity
```

### Health check
```bash
npm run health
```
Or:
```
GET /v1/health
```

## 10. Performance Issues

### Large fills
Break large operations into regions smaller than 32,768 blocks.

### Slow AI responses
Check provider status. Try a different model or provider.

### Memory usage
In-memory stores grow with activity. Restart the controller to clear.

## 11. Pi Session Failures

### AI agent not producing valid plans

Check the Pi session directory (`INTELACRAFT_PI_STORAGE_PATH`) for `messages.jsonl` to see the full conversation. Common issues:

- **Model returns malformed JSON**: The plan parser expects valid JSON. Check `messages.jsonl` for the raw AI response.
- **Model doesn't understand Minecraft blocks**: Use a model with better reasoning (GPT-4o, Claude Sonnet). Smaller models may produce invalid block references.
- **Context window exceeded**: Large tasks with many inspection results can overflow the context. Reduce the scope of the task.

### Session stuck in "thinking"

The Pi agent may be waiting for a provider response. Check:

1. Provider status: `POST /v1/providers/:id/test`
2. Model availability: `POST /v1/providers/:id/models`
3. Network connectivity to the AI provider

### Session shows "failed" status

Read the error field in the session metadata:

```bash
curl http://127.0.0.1:8787/v1/pi/sessions?status=failed
```

Common failure reasons:
- Provider returned an error (rate limit, auth failure, model unavailable)
- Plan validation failed (invalid tool names, missing required args)
- Timeout exceeded (provider took too long to respond)

## 12. SSE Reconnection

### What happens when the connection drops

The webview uses Server-Sent Events (SSE) via `/v1/events/stream` for real-time updates. If the connection drops:

1. The controller stops receiving the client for that stream
2. In-flight events for that stream are lost (no replay buffer)
3. The webview should attempt automatic reconnection

### Reconnection behavior

- The webview reconnects automatically on disconnect
- After reconnection, a full state fetch occurs (tasks, settings, etc.)
- No events are replayed—rely on polling `/v1/tasks` for missed updates

### Debugging SSE issues

- Check browser DevTools Network tab for the EventSource connection
- Look for `text/event-stream` response from `/v1/events/stream`
- Verify the bearer token is included in the request headers
- If the controller restarts, all SSE connections are closed and must be re-established

### Manual reconnection test

```bash
# Start streaming
curl -N -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8787/v1/events/stream

# In another terminal, trigger an event
curl -X POST http://127.0.0.1:8787/v1/tasks -d '{"prompt":"test"}' -H "Authorization: Bearer YOUR_TOKEN"
```

## 13. Provider Issues

### Testing provider connectivity

```bash
# Test the active provider
curl -X POST http://127.0.0.1:8787/v1/providers/ACTIVE_ID/test

# Discover available models
curl -X POST http://127.0.0.1:8787/v1/providers/ACTIVE_ID/models
```

### Common provider errors

| Error | Meaning | Fix |
|-------|---------|-----|
| `401 Unauthorized` | Invalid API key | Check `apiKey` in provider config |
| `429 Rate Limited` | Too many requests | Wait or upgrade plan |
| `502 Bad Gateway` | Provider unreachable | Check URL, network, provider status |
| `model_not_found` | Model ID incorrect | Use `POST /v1/providers/:id/models` to list available models |

### Provider-specific notes

- **OpenAI**: Ensure `baseUrl` is `https://api.openai.com/v1` (not just `https://api.openai.com`)
- **Ollama**: Ensure Ollama is running (`ollama serve`) before testing. Local models must be pulled first (`ollama pull modelname`)
- **Groq**: Free tier has rate limits. Use a paid plan for production workloads.
- **OpenRouter**: Check model availability at openrouter.ai before configuring

### Switching providers

```bash
curl -X POST http://127.0.0.1:8787/v1/providers/active \
  -d '{"providerId":"new-provider-uuid"}' \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 14. Concurrent Task Handling

### How multiple tasks work

IntelaCraft processes tasks sequentially by default:

1. **Task queue**: Tasks are created in `planning` status
2. **Planning**: One task is planned at a time (Pi agent processes one request)
3. **Approval**: Tasks wait for user approval
4. **Execution**: Approved tasks execute actions sequentially

### What happens with concurrent requests

- Multiple `POST /v1/tasks` requests create multiple tasks in the queue
- Only one task is actively planned at a time
- Other tasks wait in `planning` or `pending` status
- Actions from different tasks are interleaved in the action queue

### Task status lifecycle

```
submitted → planning → inspecting → awaiting_approval → running → verifying → completed
                       ↓                                  ↓
                    awaiting_approval                  failed
                       ↓                                  ↓
                    rejected                          cancelled
```

### Checking task queue

```bash
# List all tasks
curl http://127.0.0.1:8787/v1/tasks

# List pending tasks
curl "http://127.0.0.1:8787/v1/tasks?status=planning"
curl "http://127.0.0.1:8787/v1/tasks?status=awaiting_approval"
```

### Cancelling stuck tasks

If a task is stuck in `planning` for too long:

```bash
curl -X POST http://127.0.0.1:8787/v1/tasks/TASK_ID/cancel
```

### Reordering tasks

There is no priority system. Tasks execute in FIFO order. To prioritize:

1. Cancel lower-priority tasks
2. Re-submit higher-priority tasks
3. Re-submit cancelled tasks later
