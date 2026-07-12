# IntelaCraft Webview

The IntelaCraft webview is a single-page React application that serves as the user-facing control panel for interacting with the AI agent and managing a Minecraft Bedrock Dedicated Server (BDS).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19.1 |
| Bundler | Vite 6.3 |
| Language | TypeScript 5.x |
| Styling | CSS custom properties, dark theme |
| State | Local component state (no external library) |
| Persistence | localStorage (chat transcripts), sessionStorage (auth tokens) |

## File Structure

```
apps/webview/
├── src/
│   ├── main.tsx                        Entry point
│   ├── App.tsx                         Composition root — wires hooks, zero business logic
│   ├── types.ts                        All domain types
│   ├── constants.ts                    Permission modes, provider presets, welcome text
│   ├── api.ts                          Typed HTTP client with Bearer token
│   ├── chatStore.ts                    Conversation persistence (localStorage)
│   ├── styles.css                      Global styles & CSS custom properties
│   ├── components/                     Shared presentational components
│   │   ├── Transcript.tsx              Chat message list
│   │   ├── PlanCard.tsx               Task plan display & approval
│   │   ├── ToolCallCard.tsx           Tool execution progress
│   │   ├── ReasoningBlock.tsx          Collapsible AI thinking
│   │   ├── MarkdownText.tsx            Safe markdown renderer
│   │   ├── HighlightedJson.tsx         JSON syntax highlighting
│   │   ├── ConnectionStrip.tsx         Connection status indicator
│   │   └── WorldContextPanel.tsx       Live world stats
│   ├── features/                       Feature-scoped components
│   │   ├── LoginGate.tsx               Bearer token login form
│   │   ├── Composer/
│   │   │   ├── Composer.tsx            Main input bar (textarea, mode toggle, send/stop)
│   │   │   ├── ProviderPicker.tsx      Provider connection popover
│   │   │   ├── ModelPicker.tsx         Model selection popover
│   │   │   └── ReasoningPicker.tsx     Reasoning level dropdown
│   │   ├── Drawers/
│   │   │   ├── SafetyDrawer.tsx        Permission mode + thinking level + emergency
│   │   │   └── ActivityDrawer.tsx      Filtered activity log
│   │   └── Sidebar/
│   │       └── TaskList.tsx            Left sidebar with task list
│   ├── hooks/                          React hooks (state + side effects)
│   │   ├── useAuth.ts                  Authentication state
│   │   ├── useActivity.ts              Activity log + text filter
│   │   ├── useConversations.ts         Chat transcript, conversation management
│   │   ├── useTasks.ts                 Task CRUD (approve/reject/cancel/replan/delete)
│   │   ├── useHealth.ts               SSE operation stream, 10s full polling, active-task refresh
│   │   ├── useProviders.ts            Provider lifecycle, model catalogs, Pi session
│   │   ├── useSettings.ts             Permission mode, thinking level, emergency
│   │   ├── useChatStream.ts           SSE streaming, prompt state, auto-approve
│   │   └── useScroll.ts               Auto-scroll, jump-to-bottom
│   ├── lib/                            Pure utilities
│   │   ├── chat-helpers.ts            uid(), getAiMode(), saveAiMode(), welcomeMsg()
│   │   └── stream.ts                 SSE client (fetch-based), stream update queue
│   └── utils/
│       └── format.ts                  Tool result formatting/parsing
```

## Features

- **Chat Interface** — Natural-language conversation with the AI agent
- **Ask / Agent Mode Toggle** — Switch between Ask (question-only) and Agent (tool-using) modes via composer toggle; mode persists to localStorage and is sent with each request
- **Plan Review & Approval** — Inspect, approve, reject, or edit proposed world changes
- **Real-Time Tool Monitoring** — Watch tool executions as they happen via SSE streaming
- **Conversation Persistence** — Transcripts saved to localStorage, keyed by task ID
- **Permission Modes** — Five tiers from observe-only to trusted administrator
- **Emergency Disable** — Global kill switch to halt all mutations immediately
- **Provider Management** — Configure LLM providers, select models, and test connectivity

## Architecture

The app follows a **composition root** pattern. `App.tsx` (285 lines) instantiates all hooks and threads their returns via props — no Context or Redux. Cross-hook calls use `useRef` slots to break circular dependencies.

## How to Access

1. Start the controller: `npm run dev`
2. Open `http://127.0.0.1:8787/` in a browser
3. Enter your bearer token when prompted (stored in sessionStorage until the tab closes)

## Sub-Documents

- [components.md](./components.md) — Detailed documentation of all React components
- [data-flow.md](./data-flow.md) — Data flow, SSE streaming, REST polling, and persistence
