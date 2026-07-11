# Webview Data Flow

Technical details of how the IntelaCraft webview communicates with the controller and Minecraft BDS.

## ASCII Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         WEBVIEW (React SPA)                     │
│                                                                 │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ App.tsx  │  │ api.ts     │  │ chatStore│  │ types.ts     │ │
│  │ (compose)│  │ (fetch)    │  │(localStorage)│ (types)     │ │
│  └────┬─────┘  └─────┬──────┘  └─────┬────┘  └──────────────┘ │
│       │              │               │                          │
│  ┌────┴─────┐  ┌─────┴──────┐  ┌────┴────┐                    │
│  │ 9 hooks  │  │ lib/stream │  │ lib/    │                    │
│  │ (state)  │  │ (SSE fetch)│  │ chat-   │                    │
│  │          │  │            │  │ helpers │                    │
│  └──────────┘  └────────────┘  └─────────┘                    │
│       │              │               │                          │
└───────┼──────────────┼───────────────┼──────────────────────────┘
        │              │               │
        │ REST / SSE   │               │ localStorage
        │              │               │
        v              v               v
┌─────────────────────────────────────────────────────────────────┐
│                     CONTROLLER (Node.js HTTP)                   │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ /v1/tasks│  │ /v1/events│  │ /v1/providers│ │ /v1/pi/*  │ │
│  │ CRUD+stream│ │ /stream  │  │ +models     │  │ sessions   │ │
│  └────┬─────┘  └────┬─────┘  └──────────────┘  └──────┬─────┘ │
│       │             │                                  │        │
└───────┼─────────────┼──────────────────────────────────┼────────┘
        │             │                                  │
        v             v                                  v
┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐
│  Behavior Pack   │  │  Tool Execution  │  │  Pi Extension      │
│  (BDS Add-on)    │  │  Engine           │  │  (AI Agent)        │
│                  │  │                  │  │                    │
│  Runs commands   │  │  Inspect/Mutate/ │  │  Plans tasks,      │
│  in Minecraft    │  │  Verify tools    │  │  generates steps   │
└──────────────────┘  └──────────────────┘  └────────────────────┘
        │                     │                      │
        v                     v                      v
┌─────────────────────────────────────────────────────────────────┐
│                MINECRAFT BEDROCK DEDICATED SERVER               │
│                  (World state, players, ticks)                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Hooks Architecture

All state lives in custom React hooks. `App.tsx` instantiates them and threads returns via props — no Context or Redux.

| Hook | Lines | Responsibility |
|------|-------|----------------|
| `useAuth` | 38 | Bearer token input, login validation, sign-out |
| `useHealth` | 197 | 10s `GET /v1/health` polling, SSE event stream, bulk refresh |
| `useProviders` | 469 | Provider CRUD, model discovery, Pi session lifecycle, picker state |
| `useTasks` | 189 | Task list fetch, approve/reject/cancel/replan/delete mutations |
| `useConversations` | 143 | Active conversation, message history, localStorage persistence |
| `useChatStream` | 458 | Prompt state, SSE streaming, auto-approve read-only plans |
| `useSettings` | 146 | Permission mode, thinking level, emergency disable toggle |
| `useActivity` | 28 | Activity log aggregation, text filter |
| `useScroll` | 56 | Auto-scroll tracking, jump-to-bottom |

### Cross-Hook Communication

Hooks cannot call each other directly. `App.tsx` bridges them via `useRef` slots:

```
App.tsx
  ├── tasksRef         ──→  useConversations reads current task list
  ├── refreshRef       ──→  useChatStream / useTasks calls health.refreshAll
  ├── setPromptRef     ──→  useConversations sets the prompt input
  ├── updatePiSessionIdRef ──→ useChatStream updates the Pi session ID
  └── setPermissionModeRef ──→ useChatStream auto-switches to confirm_every_change
```

---

## REST Polling

### Task List Updates

```
GET /v1/tasks  →  every 4 seconds
```

- Returns the full list of tasks for the current session
- Polling stops for a task when it enters a terminal state (`completed`, `failed`, `cancelled`)

### Health Polling

```
GET /v1/health  →  every 10 seconds
```

- Returns server connectivity, player count, tick number, session info
- Drives the `ConnectionStrip` status dots and `WorldContextPanel`

---

## SSE Streaming

The webview uses Server-Sent Events for real-time data in three places:

### 1. Task Creation Stream

```
POST /v1/tasks/stream
Body: {
  "piSessionId": "...",
  "request": "...",
  "mode": "ask" | "agent",
  "permissionMode": "...",
  "useMcp": true,
  "worldContext": { ... },
  "history": [ ... ]
}
```

- Returns an SSE stream of model tokens as the AI generates a response
- Events: `ready`, `delta`, `reasoning_delta`, `status`, `tool`, `task`, `error`
- Used when the user sends their first message on a new task

### 2. Conversation Continuation

```
POST /v1/tasks/:id/stream
Body: {
  "request": "...",
  "mode": "ask" | "agent",
  "useMcp": true,
  "worldContext": { ... },
  "history": [ ... ]
}
```

- Resumes a conversation on an existing task
- Returns the same SSE event format as task creation
- Used when the user sends follow-up messages after a plan is rejected or revised

### 3. Live Event Stream

```
GET /v1/events/stream
```

- Receives tool execution events from the controller in real time
- Events: `ready`, `operation` (contains `OperationEventMessage` data)
- Drives the `ToolCallCard` progress indicators
- Includes 15-second keepalive pings to prevent connection timeouts

### Custom SSE Client (lib/stream.ts)

The browser's native `EventSource` does not support custom headers (e.g., `Authorization`). The webview uses a **fetch-based SSE client**:

1. `createAuthorizedEventSource(url, token)` opens a `fetch` stream with `Authorization: Bearer <token>` and `Accept: text/event-stream`
2. Reads the response body via `ReadableStream` in a `while` loop
3. Parses SSE framing (`event:`, `data:` lines) manually
4. Exposes `addEventListener(type, fn)` and `abort()` matching the `EventSource` interface

### Batched Stream Updates (createStreamUpdateQueue)

SSE deltas arrive at high frequency. To avoid re-rendering on every token:

1. `createStreamUpdateQueue(setMessages)` returns a `push(msg)` function
2. Incoming `ChatMsg` updates are buffered in a `Map<id, ChatMsg>`
3. A `requestAnimationFrame` callback flushes the buffer to `setMessages` once per frame
4. This coalesces many small updates into a single React render

---

## Conversation Persistence

### chatStore.ts

Provides functions to save and restore chat transcripts using localStorage.

| Function | Description |
|----------|-------------|
| `saveConversation(taskId, messages)` | Serialize and store a chat transcript |
| `loadConversation(taskId)` | Retrieve a previously saved transcript |
| `deleteConversation(taskId)` | Remove a saved transcript |
| `transcriptFromTask(task)` | Reconstruct a chat transcript from a task object |
| `getPersistedActiveChatId()` | Read the last active conversation ID |
| `setPersistedActiveChatId(id)` | Persist the active conversation ID |

### Storage Key

All conversations are stored in a single localStorage key:

```
intelacraft_chats_v1
```

This is a JSON object mapping task IDs to `ChatMsg[]` arrays. A separate key tracks the active chat:

```
intelacraft_active_chat
```

The AI mode (Ask vs Agent) is also persisted to localStorage under:

```
intelacraft_ai_mode
```

Values: `"ask"` (default) or `"agent"`.

### Reconstruction

When a task is loaded from the REST API, `transcriptFromTask()` rebuilds the chat history from:
- The task's `messages` array (user and assistant turns)
- Tool call results attached to each turn
- Plan proposals and approval/rejection responses

---

## Token Management

| Token | Storage | Lifetime | Purpose |
|-------|---------|----------|---------|
| Bearer token | `sessionStorage` | Tab session | Authenticates all API requests |
| Pi session ID | `localStorage` | Persistent | Identifies the AI agent session across reloads |

- The bearer token is cleared when the browser tab closes
- The Pi session ID persists across page reloads and browser restarts
- Both are attached to requests by the `api()` client in `api.ts`

---

## API Client (api.ts)

Typed wrapper around `fetch` for all controller communication.

```typescript
api<T>(method, path, body?): Promise<T>
```

### Features

- Automatic `Authorization: Bearer <token>` header
- Automatic `Content-Type: application/json` for POST/PUT/PATCH
- Typed response parsing via generic parameter `<T>`
- `ApiError` class for structured error handling (status, message, body)

### Error Handling

- Network errors throw `ApiError` with status `0`
- HTTP errors throw `ApiError` with the response status and parsed error body
- SSE streams emit `error` events for connection failures

---

## Provider Connection Flow

Step-by-step flow for connecting an LLM provider:

```
User enters base URL + API key
        │
        v
POST /v1/providers
  { "baseUrl": "...", "apiKey": "..." }
        │
        v
Provider saved, returns provider ID
        │
        v
POST /v1/providers/:id/models
        │
        v
List of available models returned
        │
        v
User selects a model
        │
        v
POST /v1/providers/:id/test
        │
        v
Connectivity verified (or error shown)
        │
        v
POST /v1/pi/sessions
  { "providerId": "...", "modelId": "..." }
        │
        v
AI session created, ready for tasks
```

---

## Permission Modes

The webview supports 5 permission modes that control what the AI agent can do without user approval:

| Mode | Behavior |
|------|----------|
| `observe_only` | Agent can only read world state; no mutations allowed |
| `confirm_every_change` | Every mutation requires explicit user approval |
| `allow_low_risk` | Low-risk mutations (read, normal) auto-approve; high-risk requires approval |
| `builder_region` | Mutations allowed within a predefined build region |
| `trusted_administrator` | All mutations auto-approved; full trust in the agent |

The selected mode is sent with each task creation request and enforced by the controller.

---

## Emergency Disable

```
POST /v1/emergency-disable
```

- Toggles a global kill switch that halts all mutation tool executions
- When active, any `mutate`-phase tool is immediately cancelled
- The `EMERGENCY` dot in the `ConnectionStrip` turns red
- Does not affect `inspect` or `verify` tools (read-only operations continue)
- State persists until explicitly toggled off
