# Package Ecosystem

IntelaCraft uses four npm workspace packages under the `@intelacraft` scope. All are private, ESM-only, and written in TypeScript.

## Packages

| Package | Purpose | Lines | External Deps |
|---------|---------|-------|---------------|
| `@intelacraft/shared-protocol` | Wire protocol types, validation, helpers | ~1,380 | 0 |
| `@intelacraft/prompts` | Versioned prompt utilities | ~18 | 0 |
| `@intelacraft/pi-extension` | AI planning agent runtime | ~944 | 3 |
| `@intelacraft/mcp-connection` | Optional advisory MCP client | ~38 | 0 |

## Dependency Graph

```
@intelacraft/shared-protocol   (foundation — zero runtime deps)
       |                |
       |                +-----> @intelacraft/bedrock-addon (BDS add-on)
       |
       +------> @intelacraft/controller (HTTP controller service)
                      |
                      +-----> @intelacraft/pi-extension
                      |            |
                      |            +-----> @intelacraft/prompts
                      |            +-----> @earendil-works/pi-coding-agent (external)
                      |            +-----> typebox (external)
                      |
                      +-----> @intelacraft/mcp-connection
```

## Build Order

Packages must be built in dependency order:

1. `shared-protocol` (no internal deps)
2. `prompts` (no internal deps)
3. `pi-extension` (depends on `prompts`)
4. `mcp-connection` (no internal deps)
5. `controller` (depends on `shared-protocol`, `pi-extension`, `mcp-connection`)
6. `bedrock-addon` (depends on `shared-protocol`)
7. `webview` (no package deps on these four)

`npm run build` at the root handles this automatically.

## Detailed Documentation

| Package | Documentation |
|---------|---------------|
| shared-protocol | [shared-protocol.md](shared-protocol.md) |
| pi-extension | [pi-extension.md](pi-extension.md) |
| prompts | [prompts.md](prompts.md) |
| mcp-connection | [mcp-connection.md](mcp-connection.md) |
