# Package Ecosystem

IntelaCraft uses five npm workspace packages under the `@intelacraft` scope. All are private, ESM-only, and written in TypeScript.

## Packages

| Package | Purpose | External Deps |
|---------|---------|---------------|
| `@intelacraft/shared-protocol` | Wire protocol types, validation, helpers | 0 |
| `@intelacraft/prompts` | Versioned prompt utilities | 0 |
| `@intelacraft/pi-extension` | AI planning agent runtime | 3 |
| `@intelacraft/mcp-connection` | Optional advisory MCP client | 0 |
| `@intelacraft/construction` | Semantic geometric build tools | 0 |

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
                      +-----> @intelacraft/construction (semantic build tools)
```

## Build Order

Packages must be built in dependency order:

1. `shared-protocol` (no internal deps)
2. `prompts` (no internal deps)
3. `construction` (depends on `shared-protocol`)
4. `pi-extension` (depends on `prompts`)
5. `mcp-connection` (no internal deps)
6. `controller` (depends on `shared-protocol`, `pi-extension`, `mcp-connection`)
7. `bedrock-addon` (depends on `shared-protocol`)
8. `webview` (no package deps on these five)

`npm run build` at the root handles this automatically.

## Detailed Documentation

| Package | Documentation |
|---------|---------------|
| shared-protocol | [shared-protocol.md](shared-protocol.md) |
| construction | [construction.md](construction.md) |
| pi-extension | [pi-extension.md](pi-extension.md) |
| prompts | [prompts.md](prompts.md) |
| mcp-connection | [mcp-connection.md](mcp-connection.md) |
