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
│   ├── components/
│   │   ├── App.tsx              (~1716 lines) Root component
│   │   ├── Transcript.tsx       Chat message list
│   │   ├── PlanCard.tsx         Task plan display & approval
│   │   ├── ToolCallCard.tsx     Tool execution progress
│   │   ├── ReasoningBlock.tsx   Collapsible AI thinking
│   │   ├── MarkdownText.tsx     Safe markdown renderer
│   │   ├── ConnectionStrip.tsx  Connection status indicator
│   │   └── WorldContextPanel.tsx Live world stats
│   ├── utils/                   Shared utilities
│   ├── api.ts                   Typed HTTP client
│   ├── chatStore.ts             Conversation persistence
│   ├── types.ts                 Shared type definitions
│   ├── App.tsx                  Root component (see above)
│   └── styles.css               Global styles & CSS custom properties
```

## Features

- **Chat Interface** — Natural-language conversation with the AI agent
- **Plan Review & Approval** — Inspect, approve, reject, or edit proposed world changes
- **Real-Time Tool Monitoring** — Watch tool executions as they happen via SSE streaming
- **Conversation Persistence** — Transcripts saved to localStorage, keyed by task ID
- **Permission Modes** — Five tiers from observe-only to trusted administrator
- **Emergency Disable** — Global kill switch to halt all mutations immediately
- **Provider Management** — Configure LLM providers, select models, and test connectivity

## How to Access

1. Start the controller: `npm run dev`
2. Open `http://127.0.0.1:8787/` in a browser
3. Enter your bearer token when prompted (stored in sessionStorage until the tab closes)

## Sub-Documents

- [components.md](./components.md) — Detailed documentation of all 7 React components
- [data-flow.md](./data-flow.md) — Data flow, SSE streaming, REST polling, and persistence
