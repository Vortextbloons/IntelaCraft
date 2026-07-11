# Provider Setup Guide

Step-by-step guide to configuring AI providers for IntelaCraft.

## Overview

IntelaCraft uses an AI provider to generate plans from natural language tasks. Each provider is configured with a base URL, API key, and model. You can configure multiple providers and switch between them.

## Adding a Provider

### Via Webview

1. Open http://127.0.0.1:8787
2. Navigate to Settings → Providers
3. Click "Add Provider"
4. Fill in the form (see provider-specific settings below)
5. Click "Test Connection" to verify
6. Click "Set Active" to use this provider

### Via API

```bash
curl -X POST http://127.0.0.1:8787/v1/providers \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OpenAI",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o"
  }'
```

Set as active:

```bash
curl -X POST http://127.0.0.1:8787/v1/providers/active \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"providerId":"provider-uuid"}'
```

## Provider Configurations

### OpenAI

| Field | Value |
|-------|-------|
| baseUrl | `https://api.openai.com/v1` |
| apiKey | Get from https://platform.openai.com/api-keys |
| model | `gpt-4o` (recommended), `gpt-4o-mini`, `gpt-4-turbo` |

**Steps:**

1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Copy the key (starts with `sk-`)
4. Add provider with baseUrl `https://api.openai.com/v1`
5. Test connection: `POST /v1/providers/:id/test`

**Thinking levels:** GPT-4o supports reasoning effort via the `thinkingLevel` parameter (low/medium/high maps to different reasoning budgets).

### Groq

| Field | Value |
|-------|-------|
| baseUrl | `https://api.groq.com/openai/v1` |
| apiKey | Get from https://console.groq.com/keys |
| model | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` |

**Steps:**

1. Go to https://console.groq.com/keys
2. Create an API key
3. Add provider with baseUrl `https://api.groq.com/openai/v1`
4. Test connection

**Notes:**

- Free tier available with generous limits
- Fast inference (often faster than OpenAI)
- OpenAI-compatible API, so IntelaCraft works without changes
- Rate limits on free tier; upgrade for production use

### Ollama (Local)

| Field | Value |
|-------|-------|
| baseUrl | `http://localhost:11434/v1` |
| apiKey | `ollama` (placeholder, not used) |
| model | `llama3.3`, `mistral`, `codellama` |

**Steps:**

1. Install Ollama: https://ollama.com/download
2. Pull a model: `ollama pull llama3.3`
3. Start Ollama: `ollama serve`
4. Add provider with baseUrl `http://localhost:11434/v1`
5. Test connection

**Notes:**

- No API key required (use any placeholder string)
- Runs entirely locally—no data leaves your machine
- Performance depends on your hardware (GPU recommended)
- Smaller models may produce less reliable plans

### OpenRouter

| Field | Value |
|-------|-------|
| baseUrl | `https://openrouter.ai/api/v1` |
| apiKey | Get from https://openrouter.ai/keys |
| model | `openai/gpt-4o`, `anthropic/claude-sonnet-4-20250514`, `meta-llama/llama-3.3-70b-instruct`, `nvidia/nemotron-3-ultra-free` |

**Steps:**

1. Go to https://openrouter.ai/keys
2. Create an API key
3. Add provider with baseUrl `https://openrouter.ai/api/v1`
4. Set model to the full model ID (e.g., `openai/gpt-4o`)
5. Test connection

**Notes:**

- Aggregates multiple providers in one API
- Compare models at https://openrouter.ai/models
- Pricing varies by model
- OpenAI-compatible API format

#### NVIDIA Nemotron 3 Ultra Free

| Field | Value |
|-------|-------|
| baseUrl | `https://openrouter.ai/api/v1` |
| model | `nvidia/nemotron-3-ultra-free` |

**Notes:**

- Reasoning/thinking is **disabled** for this model (forced to `off`). The Nemotron NIM implementation does not support OpenAI-compatible reasoning tokens.
- Provider connectivity testing uses a named `tool_choice` function call (not `"required"`) because the NIM gateway does not support the `"required"` shortcut. This is handled automatically by IntelaCraft.

### Custom OpenAI-Compatible

Any endpoint that implements the OpenAI `/v1/chat/completions` API works:

| Field | Value |
|-------|-------|
| baseUrl | Your endpoint URL (must include `/v1`) |
| apiKey | Your authentication key |
| model | Model ID supported by your endpoint |

**Requirements:**

- Must implement `POST /v1/chat/completions`
- Must return OpenAI-compatible response format
- Must support the `model` parameter
- Streaming (`stream: true`) is recommended but not required

**Examples:**

- Azure OpenAI: `https://your-resource.openai.azure.com/openai/deployments/your-deployment`
- Together AI: `https://api.together.xyz/v1`
- Anyscale: `https://api.endpoints.anyscale.com/v1`
- Fireworks AI: `https://api.fireworks.ai/inference/v1`

## Testing Provider Connectivity

```bash
# Test a specific provider
curl -X POST http://127.0.0.1:8787/v1/providers/PROVIDER_ID/test

# Response (success)
{
  "ok": true,
  "latency": 340,
  "model": "gpt-4o"
}

# Response (failure)
{
  "ok": false,
  "error": "401 Unauthorized"
}
```

## Discovering Available Models

```bash
# List models for a provider
curl -X POST http://127.0.0.1:8787/v1/providers/PROVIDER_ID/models

# Response
{
  "models": [
    { "id": "gpt-4o", "name": "GPT-4o" },
    { "id": "gpt-4o-mini", "name": "GPT-4o Mini" }
  ]
}
```

Not all providers support model discovery. If the endpoint returns an error, manually specify the model ID in your provider configuration.

## Thinking Levels

The `thinkingLevel` parameter controls how much reasoning effort the AI applies to planning:

| Level | Behavior | When to Use |
|-------|----------|-------------|
| `off` | No reasoning tokens | Fastest, raw model output |
| `minimal` | Bare minimum reasoning | Trivial tasks |
| `low` | Quick reasoning | Simple tasks (fill area, set time) |
| `medium` | Balanced reasoning | Most tasks (default) |
| `high` | Deep reasoning | Complex tasks (build structures) |
| `xhigh` | Extended reasoning | Very complex multi-step plans |
| `max` | Maximum reasoning budget | Largest tasks with many constraints |

**Model support:**

- **OpenAI o3/o3-mini/o3-pro/o4-mini**: Full support (maps to reasoning effort)
- **Claude Sonnet 4 / Opus 4**: Full support via override mappings
- **DeepSeek R1**: Supported
- **Gemini 2.5 Pro/Flash**: Supported
- **NVIDIA Nemotron 3 Ultra Free**: Disabled (forced to `off`)
- **Groq Llama**: Reasoning levels are excluded entirely (Groq doesn't support `reasoning_effort`)
- **Ollama**: Limited (depends on model size)
- **Other OpenAI-compatible**: Defaults to supported with levels `off`/`minimal`/`low`/`medium`/`high`

Set the default thinking level in webview settings or override per task:

```bash
curl -X POST http://127.0.0.1:8787/v1/tasks \
  -d '{"prompt":"complex build task","thinkingLevel":"high"}'
```

## Switching Providers

Switch the active provider without reconfiguring:

```bash
curl -X POST http://127.0.0.1:8787/v1/providers/active \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"providerId":"other-provider-uuid"}'
```

The switch takes effect immediately. In-progress tasks use the provider that was active when they started.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `401 Unauthorized` | Check API key is correct and has no extra whitespace |
| `404 Not Found` | Verify baseUrl ends with `/v1` |
| `429 Rate Limited` | Wait or upgrade your provider plan |
| `502 Bad Gateway` | Provider is unreachable—check URL and network |
| `model_not_found` | Use `POST /v1/providers/:id/models` to list available models |
| Slow responses | Try a faster model or provider (Groq is fastest) |
| Bad plans | Use a larger model (GPT-4o, Claude Sonnet) or increase thinking level |
