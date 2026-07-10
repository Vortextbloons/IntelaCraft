# Webview Components

All 7 React components that make up the IntelaCraft webview control panel.

## Component Hierarchy

```
App.tsx
├── ConnectionStrip.tsx          (status bar)
├── WorldContextPanel.tsx        (sidebar header)
├── Transcript.tsx               (workspace main)
│   ├── ReasoningBlock.tsx
│   ├── MarkdownText.tsx
│   ├── ToolCallCard.tsx
│   └── PlanCard.tsx
└── [Drawer — Activity Log]
```

---

## App.tsx (~1716 lines)

Root monolithic component containing all application state and logic.

### State Management

Uses React hooks exclusively — no external state library:

- `useState` for UI state, task list, active task, chat messages
- `useEffect` for SSE connections, REST polling, authentication
- `useMemo` for derived data (filtered tasks, conversation transcript)
- `useCallback` for stable handler references
- `useRef` for mutable values that don't trigger re-renders (SSE controllers, DOM refs)

### Authentication

- Bearer token entered by user, stored in `sessionStorage`
- Cleared automatically when the browser tab closes
- Attached to every request via the `api()` client

### Provider / Model Selection

1. User enters base URL and API key for an LLM provider
2. `POST /v1/providers` saves the provider
3. `POST /v1/providers/:id/models` discovers available models
4. `POST /v1/providers/:id/test` verifies connectivity
5. `POST /v1/pi/sessions` creates an AI session bound to the selected model

### Task Lifecycle

| Action | Endpoint | Description |
|--------|----------|-------------|
| Create | `POST /v1/tasks` | Start a new task from a user message |
| Approve | `POST /v1/tasks/:id/approve` | Accept the proposed plan |
| Reject | `POST /v1/tasks/:id/reject` | Decline the plan, request revision |
| Cancel | `POST /v1/tasks/:id/cancel` | Abort a running or pending task |
| Replan | `POST /v1/tasks/:id/replan` | Request a new plan for the same goal |
| Delete | `DELETE /v1/tasks/:id` | Remove a completed or cancelled task |

### SSE Streaming

- **Task creation**: `POST /v1/tasks/stream` returns an SSE stream with real-time model tokens as they are generated
- **Continuation**: `POST /v1/tasks/:id/stream` resumes a conversation on an existing task
- **Live events**: `GET /v1/events/stream` receives tool execution events from the controller

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
│              Connection Strip                   │
└────────────────────────────────────────────────┘
```

A collapsible drawer on the right shows the activity log.

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
