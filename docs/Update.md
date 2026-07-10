# Documentation Update Instructions

Review the entire codebase and create or update its documentation.

## Requirements

* First inspect the project structure, configuration, dependencies, and major features.
* Update existing documentation instead of replacing it unnecessarily.
* Only change documentation when the codebase has actually changed or information is missing, outdated, or incorrect.
* Organize detailed documentation inside `docs/` using separate, focused files in sub-folders.
* Keep the root `README.md` concise and include setup, usage, key features, and links to deeper documentation.
* Document the architecture, important modules, data flow, configuration, development workflow, testing, deployment, and common troubleshooting.
* Use examples where they improve clarity.
* Do not document obvious implementation details or generate filler.
* Clearly mark anything that could not be verified from the code.
* At the end, provide a brief summary of the documentation files created, updated, or intentionally left unchanged.

## Existing Documentation Structure

When updating docs, follow this structure:

```
docs/
├── INDEX.md                          Master index (update when adding/removing files)
├── ALL.md                            Auto-generated combined doc (run npm run combine-docs to regenerate)
├── architecture/
│   ├── overview.md                   System architecture, components, trust boundaries
│   └── data-flow.md                  Message flow, protocols, sequence diagrams
├── components/
│   ├── bedrock-addon/
│   │   ├── README.md                 Addon overview, safety layers
│   │   ├── session.md               Session lifecycle, handshake, poll, heartbeat
│   │   ├── inspection-tools.md      All 10 read-only world query tools
│   │   ├── mutation-tools.md        Fill blocks, control, admin commands
│   │   └── build-deploy.md          esbuild, dev/prod deploy, BDS config
│   ├── webview/
│   │   ├── README.md                React SPA overview
│   │   ├── components.md            All 7 React components
│   │   └── data-flow.md            REST polling, SSE, persistence
│   ├── controller/
│   │   ├── README.md                HTTP server overview
│   │   ├── stores.md                Session, event, settings, activity stores
│   │   ├── policy.md                Risk classification, approval, permissions
│   │   └── agent-runtime.md        Task lifecycle, planning, inspection-replan
│   └── packages/
│       ├── README.md                Package ecosystem overview
│       ├── shared-protocol.md       Wire protocol types, validation
│       ├── pi-extension.md          AI planning agent runtime
│       ├── prompts.md               Prompt utilities
│       └── mcp-connection.md        Advisory MCP client
├── guides/
│   ├── development.md               Dev setup, conventions, extending
│   ├── testing.md                   Test runner, mocks, writing tests
│   ├── deployment.md                Production deployment
│   └── provider-setup.md           Configuring AI providers
├── reference/
│   ├── api.md                       Complete HTTP API reference
│   ├── configuration.md             Environment variables, permission modes
│   └── protocol.md                  Message types, tools, validation
├── ops/
│   ├── runbook.md                   Operations runbook
│   └── security-review.md           Trust model, threat analysis
├── troubleshooting.md               Common issues and solutions
└── Update.md                        This file (agent instructions)
```

## After Updating Documentation

1. Update `docs/INDEX.md` if you added, removed, or renamed any documentation file
2. Run `npm run combine-docs` to regenerate `docs/ALL.md`
3. Verify links in `README.md` and `AGENTS.md` still point to correct paths
