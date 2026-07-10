# IntelaCraft Documentation

Master index for all project documentation. Organized by topic for quick navigation.

## Architecture

High-level system design, component responsibilities, and data flow.

| File | Description |
|------|-------------|
| [architecture/overview.md](architecture/overview.md) | System architecture, 7 components, trust boundaries, deployment topology |
| [architecture/data-flow.md](architecture/data-flow.md) | Primary workflow, message protocol, SSE streaming, safety flow, task lifecycle |

## Components — Bedrock Addon

The in-game execution agent that runs inside Minecraft Bedrock Dedicated Server.

| File | Description |
|------|-------------|
| [components/bedrock-addon/README.md](components/bedrock-addon/README.md) | Addon overview, file structure, safety layers, BDS configuration |
| [components/bedrock-addon/session.md](components/bedrock-addon/session.md) | Session lifecycle: handshake, poll loop (2s), heartbeat (6s), reconnection |
| [components/bedrock-addon/inspection-tools.md](components/bedrock-addon/inspection-tools.md) | All 10 read-only world query tools with args, API calls, return values |
| [components/bedrock-addon/mutation-tools.md](components/bedrock-addon/mutation-tools.md) | All 4 mutation tools: fill_blocks, control.cancel, emergency_disable, admin.run_command |
| [components/bedrock-addon/build-deploy.md](components/bedrock-addon/build-deploy.md) | esbuild bundling, dev/prod deployment, BDS config writing, pack manifests |

## Components — Webview

React control panel SPA served by the controller.

| File | Description |
|------|-------------|
| [components/webview/README.md](components/webview/README.md) | Webview overview, tech stack, features, access instructions |
| [components/webview/components.md](components/webview/components.md) | All 7 React components with props, behavior, hierarchy diagram |
| [components/webview/data-flow.md](components/webview/data-flow.md) | REST polling, SSE streaming, conversation persistence, provider flow |

## Components — Controller

Central HTTP server bridging BDS, webview, and AI agent.

| File | Description |
|------|-------------|
| [components/controller/README.md](components/controller/README.md) | Controller overview, file structure, API surface, authentication |
| [components/controller/stores.md](components/controller/stores.md) | SessionStore, EventStore, SettingsStore, ActivityStore, AuditLog |
| [components/controller/policy.md](components/controller/policy.md) | Risk classification, approval binding, permission modes, protected regions |
| [components/controller/agent-runtime.md](components/controller/agent-runtime.md) | Task lifecycle, planning flow, inspection-replan, provider management |

## Components — Packages

npm workspace packages under @intelacraft scope.

| File | Description |
|------|-------------|
| [components/packages/README.md](components/packages/README.md) | Package ecosystem overview, dependency graph, build order |
| [components/packages/shared-protocol.md](components/packages/shared-protocol.md) | Wire protocol: constants, types, validation, helpers, factories |
| [components/packages/pi-extension.md](components/packages/pi-extension.md) | AI planning agent: system prompt, tools, session lifecycle, plan normalization |
| [components/packages/prompts.md](components/packages/prompts.md) | Prompt utilities: wrapUntrusted, adminAllowlistSection |
| [components/packages/mcp-connection.md](components/packages/mcp-connection.md) | Advisory MCP client: graceful degradation, query interface |

## Reference

API documentation, configuration, and protocol specification.

| File | Description |
|------|-------------|
| [reference/api.md](reference/api.md) | Complete HTTP API reference (21 endpoints) with request/response formats |
| [reference/configuration.md](reference/configuration.md) | Environment variables, BDS config, permission modes, risk classes |
| [reference/protocol.md](reference/protocol.md) | Protocol versioning, 8 message types, 14 tools, constants, validation |

## Guides

Step-by-step instructions for development, testing, deployment, and provider setup.

| File | Description |
|------|-------------|
| [guides/development.md](guides/development.md) | Developer setup, coding conventions, extending the system |
| [guides/testing.md](guides/testing.md) | Testing framework, mock strategies, writing tests |
| [guides/deployment.md](guides/deployment.md) | Local dev, BDS setup, pack deployment, production considerations |
| [guides/provider-setup.md](guides/provider-setup.md) | Configuring AI providers: OpenAI, Groq, Ollama, OpenRouter, custom |

## Operations

Runbook, security analysis, and troubleshooting.

| File | Description |
|------|-------------|
| [ops/runbook.md](ops/runbook.md) | Operations runbook: start/stop, deploy, incident response |
| [ops/security-review.md](ops/security-review.md) | Trust model, threat analysis, residual risks |
| [troubleshooting.md](troubleshooting.md) | Common issues and solutions for all components |

## Other

| File | Description |
|------|-------------|
| [Update.md](Update.md) | Agent instructions for reviewing/updating documentation |

## File Count

**30 documentation files** across 7 directories, totaling ~230 KB.
