# Webview Components

All React components that make up the IntelaCraft webview control panel.

## Component Hierarchy

```
main.tsx
└── App.tsx (composition root)
    ├── LoginGate.tsx                  (auth gate)
    ├── TaskList.tsx                   (left sidebar)
    ├── WorldContextPanel.tsx          (sidebar header)
    ├── Transcript.tsx                 (workspace main)
    │   ├── ReasoningBlock.tsx
    │   ├── MarkdownText.tsx
    │   ├── HighlightedJson.tsx
    │   ├── ToolCallCard.tsx
    │   └── PlanCard.tsx
    ├── Composer.tsx                   (input bar)
    │   ├── ProviderPicker.tsx         (popover)
    │   ├── ModelPicker.tsx            (popover)
    │   └── ReasoningPicker.tsx        (dropdown)
    ├── SafetyDrawer.tsx               (right drawer)
    ├── ActivityDrawer.tsx             (right drawer)
    └── ConnectionStrip.tsx            (status bar)
```

---

## App.tsx (285 lines)

Composition root. Instantiates all hooks and threads their returns via props — zero business logic.

### Hook Wiring

| Hook | Purpose | Key Returns |
|------|---------|-------------|
| `useAuth` | Bearer token login | `authed`, `login`, `signOut` |
| `useHealth` | 10s polling + SSE | `health`, `refreshAll` |
| `useProviders` | Provider lifecycle | `providers`, `activeProviderId`, `connectProvider`, `pickModel` |
| `useTasks` | Task CRUD | `tasks`, `approveTask`, `rejectTask`, `cancelTask` |
| `useConversations` | Chat transcript | `messages`, `selectedTaskId`, `sendMessage` |
| `useChatStream` | SSE streaming | `prompt`, `setPrompt`, `sendPrompt`, `stopStream` |
| `useSettings` | Permission/thinking | `permissionMode`, `thinkingLevel`, `emergencyDisable` |
| `useActivity` | Activity log | `activityLog`, `activityFilter` |
| `useScroll` | Auto-scroll | `stickToBottom`, `scrollRef` |

### Ref-Based Cross-Hook Calls

Five `useRef` slots break circular dependencies between hooks:

- `tasksRef` — current task list, read by `useConversations`
- `refreshRef` — `useHealth.refreshAll`, called after task mutations
- `setPromptRef` — `useChatStream.setPrompt`, called by `useConversations`
- `updatePiSessionIdRef` — `useProviders.updatePiSessionId`, called by `useChatStream`
- `setPermissionModeRef` — `useSettings.setPermissionMode`, called by auto-approve logic

### Layout

```
┌──────────────┬─────────────────────────────────┐
│              │                                 │
│   Sidebar    │          Workspace              │
│              │                                 │
│  - Task list │  - Chat transcript              │
│  - Settings  │  - Plan cards                   │
│              │  - Tool call progress            │
├──────────────┴─────────────────────────────────┤
│  [Composer]                                     │
│  ┌────────────────────────────────────────────┐ │
│  │  textarea (message input)                  │ │
│  ├────────────────────────────────────────────┤ │
│  │  model-picker  │  [Ask|Agent]  [Send/Stop] │ │
│  └────────────────────────────────────────────┘ │
├────────────────────────────────────────────────┤
│              Connection Strip                   │
└────────────────────────────────────────────────┘
```

A collapsible drawer on the right shows the activity log or safety settings.

---

## LoginGate.tsx

Bearer token login form. Shown when the user is not authenticated.

- Text input for the bearer token
- Submits via `useAuth.login`, which validates the token against `GET /v1/settings`
- On failure, clears the token and shows the error message
- On success, renders children (the main app)

---

## Composer.tsx

Main input bar with textarea, mode toggle, and send/stop button.

### Features

- Auto-resizing textarea (grows with input up to max height)
- Ask / Agent mode toggle (persisted to localStorage)
- Send button (enabled when prompt is non-empty and not streaming)
- Stop button (visible during active stream, calls `abort()` on the SSE controller)

### Sub-Components

- **ProviderPicker** — Popover to select/add an LLM provider
- **ModelPicker** — Popover to select a model from the active provider's catalog
- **ReasoningPicker** — Dropdown to select reasoning level (off, low, medium, high)

---

## ProviderPicker.tsx

Popover for managing LLM provider connections.

### Flow

1. User selects a preset (OpenCode Zen, OpenAI, OpenRouter, Groq, Ollama, Custom) or enters a custom base URL + API key
2. `POST /v1/providers` saves the provider
3. `POST /v1/providers/:id/models` discovers available models
4. `POST /v1/providers/:id/test` verifies connectivity
5. Active provider is highlighted; clicking "Connect" calls `useProviders.connectProvider`

### Presets

Seven built-in provider presets defined in `constants.ts`:

| Preset | Base URL | Default Model |
|--------|----------|---------------|
| OpenCode Zen | opencode.ai/zen/v1 | gpt-5.4-mini |
| OpenCode Go | opencode.ai/zen/go/v1 | qwen3-coder |
| OpenAI / Codex | api.openai.com/v1 | gpt-4.1-mini |
| OpenRouter | openrouter.ai/api/v1 | openai/gpt-4.1-mini |
| Groq | api.groq.com/openai/v1 | llama-3.3-70b-versatile |
| Ollama (local) | 127.0.0.1:11434/v1 | llama3.2 |
| Custom | 127.0.0.1:8080/v1 | local-model |

---

## ModelPicker.tsx

Popover for selecting a model from the active provider's catalog.

- Lists models returned by `POST /v1/providers/:id/models`
- Shows model capabilities (reasoning support, context window)
- Selecting a model creates/updates the Pi session via `POST /v1/pi/sessions`
- Displays current model name as the trigger button label

---

## ReasoningPicker.tsx

Dropdown to select the AI reasoning level.

- Options: `off`, `low`, `medium`, `high`
- Stored in `useSettings` and sent with task creation requests
- Only enabled when the selected model supports reasoning (per `ReasoningCapabilities`)

---

## Transcript.tsx

Renders the ordered list of chat messages.

- Iterates the `ChatMsg[]` array passed from `App.tsx`
- Resolves the associated task object by `taskId` on each message
- Delegates rendering to sub-components based on message content type:
  - `ReasoningBlock` — AI thinking steps
  - `MarkdownText` — User and assistant text
  - `ToolCallCard` — Tool invocations and results
  - `PlanCard` — Task plan proposals
- Displays a "Jump to latest" floating button when the user scrolls up

---

## PlanCard.tsx

Displays a proposed task plan with three sections:

| Section | Content |
|---------|---------|
| **Inspect** | Read-only world queries (no mutations) |
| **Mutations** | Actions that modify the world, each with a risk badge and block count |
| **Verify** | Post-action validation checks |

### Risk Badges

| Risk Level | Color | Meaning |
|------------|-------|---------|
| `read` | Green | No side effects |
| `normal` | Blue | Standard world edits |
| `strong` | Orange | Destructive or large-scale changes |
| `prohibited` | Red | Blocked by permission policy |

### Action Buttons

- **Approve** — Execute the plan
- **Reject** — Decline and optionally provide feedback
- **Edit & Replan** — Request a modified plan
- **Cancel** — Abort the task entirely

### Construction Preview

When `task.preview` exists (populated for semantic builds), an additional section displays:

- Total generated blocks, estimated batches, rollback coverage percentage
- Material breakdown (e.g., `stone × 200, oak_planks × 50`)
- Any warnings (e.g., protected region conflicts, partial rollback)

### Build Steps

When `task.plan.build` exists, a "Build steps" section lists each step with its ID, summary, tool name, and dependency chain.

---

## ToolCallCard.tsx

Shows the live progress of a single tool execution.

### Data Sources

Works from two sources:
- `MessagePart` — captured during SSE streaming (historical)
- `ToolRun` — live data from `GET /v1/events/stream`

### Display

- Tool name and phase: `inspect` | `mutate` | `verify` | `plan`
- Execution state: `running` (animated) | `completed` | `failed`
- Progress bar for long-running tools
- Collapsible argument summary and result text

---

## ReasoningBlock.tsx

Collapsible container for the AI's internal thinking.

- **While streaming**: Auto-opens, green-tinted background, shows thinking tokens as they arrive
- **When done**: Collapses automatically, user can toggle open/closed

---

## MarkdownText.tsx

Lightweight, safe markdown renderer (no external library).

### Rendering Rules

1. Escapes all raw HTML to prevent XSS
2. Converts backtick-wrapped text to `<code>` elements
3. Converts `**bold**` to `<strong>`
4. Converts newlines to `<br>`

---

## HighlightedJson.tsx

Tokenizes and syntax-highlights a JSON value as colored `<span>` elements.

### Props

| Prop | Type | Description |
|------|------|-------------|
| `value` | `unknown` | JSON-serializable value (objects are pretty-printed) |
| `className` | `string?` | Optional CSS class appended to the `<pre>` element |

### Rendering

1. Converts the value to a pretty-printed JSON string (or uses the string directly)
2. Tokenizes using a single-pass regex that identifies: keys, strings, numbers, literals (`true`/`false`/`null`), punctuation, and whitespace
3. Renders each token as a `<span>` with a CSS class: `json-key`, `json-string`, `json-number`, `json-literal`, `json-punct`

Styling is provided by `.json-hl` and its child selectors in `styles.css`.

---

## ConnectionStrip.tsx

Fixed status bar at the bottom of the UI showing 5 connection indicators:

| Dot | Service | Description |
|-----|---------|-------------|
| BDS | Server | Minecraft BDS process connection |
| Model | LLM | Selected language model availability |
| Pi | Agent | Planning agent session |
| MCP | Advisory | Optional MCP advisory server |
| EMERGENCY | Kill Switch | Global mutation disable status |

### Status Colors

| Status | Color | Meaning |
|--------|-------|---------|
| `ok` | Green | Connected and healthy |
| `warn` | Yellow | Degraded or reconnecting |
| `bad` | Red | Disconnected or error |
| `off` | Gray | Not configured |

---

## WorldContextPanel.tsx

Displays live world statistics in the sidebar header.

### Data Source

Polls `GET /v1/health` at a regular interval.

### Displayed Info

- **Server ID** — Unique identifier for the BDS instance
- **Player Count** — Currently connected players
- **Tick Number** — Current server tick
- **Health Status** — Overall system health indicator

---

## SafetyDrawer.tsx

Right-side drawer for permission and safety controls.

- **Permission mode** — Select from the 5 modes (`observe_only` through `trusted_administrator`)
- **Thinking level** — Override the model's reasoning level
- **Emergency disable** — Toggle the global mutation kill switch (`POST /v1/emergency-disable`)

---

## ActivityDrawer.tsx

Right-side drawer showing a filtered activity log.

- Displays `ToolRun` records from `useActivity`
- Text filter input to search by tool name or description
- Shows phase, status, and timestamp for each entry

---

## TaskList.tsx

Left sidebar component rendering the list of tasks.

- Fetches tasks from `useTasks` hook
- Highlights the currently selected task
- Shows task state (pending, running, completed, failed, cancelled)
- Clicking a task switches the conversation transcript to that task's history
