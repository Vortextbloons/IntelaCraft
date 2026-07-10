# @intelacraft/prompts

A minimal, versioned prompt utility package for the AI planner system.

**Zero runtime dependencies.**

## Exports

### PROMPT_VERSION

```typescript
const PROMPT_VERSION = "1.1.0";
```

Version string for tracking prompt changes independently of protocol version.

### wrapUntrusted(tag, value)

```typescript
function wrapUntrusted(tag: string, value: unknown): string;
```

Wraps arbitrary data in XML-style tags with JSON serialization inside.

**Purpose**: Prompt injection defense. The AI system prompt instructs the model to treat content inside these tags as data, never as instructions.

**Example**:
```typescript
wrapUntrusted("untrusted_world_context", { playerCount: 3, tick: 12345 })
// Returns:
// <untrusted_world_context>
// {"playerCount":3,"tick":12345}
// </untrusted_world_context>
```

**Usage in pi-extension**:
- World context (server health, player count, admin commands) wrapped in `<untrusted_world_context>`
- MCP advisory responses wrapped in `<untrusted_mcp_advice>`
- Tool results wrapped in `[tool result <toolName>]` tags

### adminAllowlistSection(commandIds)

```typescript
function adminAllowlistSection(commandIds: string[]): string;
```

Generates a Markdown-formatted section listing valid admin command IDs for inclusion in the system prompt.

**When empty**:
```markdown
Admin commands: (none configured -- do not propose admin.run_command)
```

**When populated**:
```markdown
Admin commands (use commandId only, never raw strings):
- time_day
- weather_clear
- give_diamond
```

## How They're Used

Consumed by `@intelacraft/pi-extension` to build the system prompt:

1. `buildSystemPrompt(adminCommandIds)` combines the base `SYSTEM` prompt with `adminAllowlistSection(adminCommandIds)`
2. `wrapUntrusted` wraps world context and MCP advice before injecting into the planning prompt
3. The prompt version is tracked independently to allow prompt iteration without protocol changes
