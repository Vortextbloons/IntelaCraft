# Documentation Update Instructions

Review the entire codebase and create or update its documentation using multiple specialized subagents working in parallel.

## Coordination

Assign independent documentation areas to separate subagents whenever their work does not overlap.

Suggested responsibilities:

* Architecture and system data flow
* Bedrock add-on
* Controller and agent runtime
* Webview
* Shared packages and protocols
* API and configuration reference
* Development, testing, and deployment guides
* Operations, security, and troubleshooting
* Final documentation verification

Each subagent must inspect the relevant source code, configuration, tests, and existing documentation before making changes.

Avoid having multiple subagents edit the same file simultaneously. Assign clear file ownership before work begins.

A final integration agent must review all documentation changes, resolve contradictions, verify links, check terminology, and run the required documentation scripts.

## Requirements

* First inspect the project structure, configuration, dependencies, tests, and major features.
* Update existing documentation instead of replacing it unnecessarily.
* Only change documentation when the codebase has changed or information is missing, outdated, unclear, or incorrect.
* Organize detailed documentation inside `docs/` using separate, focused files and subfolders.
* Keep the root `README.md` concise and include setup, usage, key features, and links to deeper documentation.
* Document architecture, important modules, data flow, configuration, development workflow, testing, deployment, security boundaries, operations, and common troubleshooting.
* Use examples and diagrams only when they materially improve clarity.
* Do not document obvious implementation details or generate filler.
* Clearly mark claims that could not be verified from the code.
* Preserve consistent terminology, paths, API names, tool names, and configuration names across every file.
* Do not infer functionality from old documentation when the current code contradicts it.

## Existing Documentation Structure

Follow this structure when updating documentation:

```text
docs/
├── INDEX.md
├── ALL.md
├── architecture/
│   ├── overview.md
│   └── data-flow.md
├── components/
│   ├── bedrock-addon/
│   │   ├── README.md
│   │   ├── session.md
│   │   ├── inspection-tools.md
│   │   ├── mutation-tools.md
│   │   └── build-deploy.md
│   ├── webview/
│   │   ├── README.md
│   │   ├── components.md
│   │   └── data-flow.md
│   ├── controller/
│   │   ├── README.md
│   │   ├── stores.md
│   │   ├── policy.md
│   │   └── agent-runtime.md
│   └── packages/
│       ├── README.md
│       ├── shared-protocol.md
│       ├── construction.md
│       ├── pi-extension.md
│       ├── prompts.md
│       └── mcp-connection.md
├── guides/
│   ├── development.md
│   ├── testing.md
│   ├── deployment.md
│   └── provider-setup.md
├── reference/
│   ├── api.md
│   ├── configuration.md
│   └── protocol.md
├── ops/
│   ├── runbook.md
│   └── security-review.md
├── troubleshooting.md
└── Update.md
```

## Parallel Workflow

1. Create a shared inventory of workspaces, major modules, configuration files, scripts, tests, APIs, and existing documentation.
2. Assign non-overlapping documentation files or folders to subagents.
3. Have each subagent compare its assigned documentation directly against the implementation.
4. Require each subagent to report:

   * Files inspected
   * Documentation changed
   * Incorrect or stale claims found
   * Unverified information
   * Potential conflicts with other documentation
5. Send cross-component inconsistencies to the final integration agent rather than allowing subagents to independently invent resolutions.
6. The final integration agent must inspect the combined changes and verify that documentation agrees across component, architecture, protocol, API, and configuration files.

## Final Verification

After all subagents finish:

1. Update `docs/INDEX.md` if any documentation file was added, removed, or renamed.
2. Run:

```bash
npm run combine-docs
```

3. Confirm that `docs/ALL.md` was regenerated successfully and was not manually edited.
4. Verify links in:

   * `README.md`
   * `AGENTS.md`
   * `docs/INDEX.md`
   * All modified documentation files
5. Compare documented commands with scripts in `package.json`.
6. Compare documented environment variables with the actual configuration loaders.
7. Compare API documentation with the implemented routes and request schemas.
8. Compare protocol and tool documentation with shared types, validators, and runtime implementations.
9. Run relevant documentation checks, tests, type checks, or builds when available.
10. Review the final diff and remove unnecessary formatting churn or unsupported claims.

## Final Report

Provide a brief consolidated summary containing:

* Documentation files created
* Documentation files updated
* Documentation files intentionally left unchanged
* Important outdated or incorrect information corrected
* Commands and checks performed
* Any remaining unverified items or documentation gaps
* Any checks that failed, including the reason

Do not provide separate repetitive summaries from every subagent. Combine their findings into one concise final report.
