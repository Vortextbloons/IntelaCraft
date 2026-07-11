# IntelaCraft

An AI-assisted control system for Minecraft Bedrock Dedicated Server. You describe what you want in natural language, an AI agent inspects your world and proposes a plan, you approve or reject it, and a behavior pack executes the changes safely on your server.

## How it works

```
You: "Build a 10x10 stone house at 0,64,0"
         |
         v
   AI agent inspects the world (players, blocks, time, weather)
         |
         v
   Agent proposes a plan with risk assessment:
     - inspect: check current state at coordinates
     - mutate: fill 100 blocks with minecraft:stone (normal risk)
     - verify: inspect the region after building
         |
         v
   You review and approve in the web control panel
         |
         v
   Behavior pack executes the fill on your BDS server
         |
         v
   Results stream back in real-time
```

## Key features

- **Natural language control** — Describe tasks in plain English, the AI figures out the Minecraft commands
- **Human-in-the-loop** — Every world change requires your explicit approval before execution
- **Ask / Agent modes** — Toggle between read-only Ask mode (inspections and questions only) and Agent mode (tool-using, can propose changes)
- **Safety by default** — Protected regions, volume limits, emergency kill switch, full audit trail
- **Live world inspection** — The AI can query players, blocks, entities, time, weather, scoreboards, and more
- **Real-time streaming** — Watch the AI think and execute in real-time through the web panel
- **Multiple permission modes** — From observe-only to trusted administrator, you choose the safety level
- **Provider flexible** — Works with OpenAI, Groq, Ollama, OpenRouter, or any OpenAI-compatible API

## Quick start

```powershell
npm run setup     # install deps, build, create .env
npm run dev       # start controller at http://127.0.0.1:8787
```

Open the webview, enter your bearer token, connect an AI provider, and start talking to your server.

## Commands

| Command | What it does |
|---------|-------------|
| `npm run setup` | Install + build + create `.env` |
| `npm run dev` | Start controller (serves webview + API) |
| `npm run build` | Build all packages |
| `npm run deploy` | Deploy packs to BDS |
| `npm run health` | Check controller/BDS status |
| `npm test` | Run tests |

## Safety model

| Mode | Behavior |
|------|----------|
| `observe_only` | Read-only — AI can inspect but never modify |
| `confirm_every_change` | Every mutation needs your approval (default) |
| `allow_low_risk` | Small changes auto-approved, large changes need approval |
| `builder_region` | Builds restricted to configured regions |
| `trusted_administrator` | All changes trusted (use with caution) |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Webview   │────▶│  Controller  │◀────│  AI Agent (Pi)  │
│  (React)    │     │  (Node.js)   │     │  (LLM + tools)  │
└─────────────┘     └──────┬───────┘     └─────────────────┘
                           │
                    ┌──────▼───────┐
                    │  BDS Addon   │
                    │  (Minecraft) │
                    └──────────────┘
```

- **Webview** — React control panel served by the controller
- **Controller** — HTTP server bridging everything, enforces policy
- **AI Agent** — Plans actions using an LLM, inspects the live world
- **BDS Addon** — Behavior pack that executes changes inside Minecraft

## Documentation

Full documentation is in [`docs/INDEX.md`](docs/INDEX.md).

| Topic | Link |
|-------|------|
| Architecture | [docs/architecture/](docs/architecture/overview.md) |
| API Reference | [docs/reference/api.md](docs/reference/api.md) |
| Configuration | [docs/reference/configuration.md](docs/reference/configuration.md) |
| Development | [docs/guides/development.md](docs/guides/development.md) |
| Deployment | [docs/guides/deployment.md](docs/guides/deployment.md) |
| Troubleshooting | [docs/troubleshooting.md](docs/troubleshooting.md) |

Or combine all docs into one file: `npm run combine-docs`
