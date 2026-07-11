# Webview Data Flow

Technical details of how the IntelaCraft webview communicates with the controller and Minecraft BDS.

## ASCII Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         WEBVIEW (React SPA)                     │
│                                                                 │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ App.tsx  │  │ api.ts     │  │ chatStore│  │ types.ts     │ │
│  │ (state)  │  │ (fetch)    │  │ (localStorage) │ (types)   │ │
│  └────┬─────┘  └─────┬──────┘  └─────┬────┘  └──────────────┘ │
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

## REST Polling

### Task List Updates

```
GET /v1/tasks  →  every 4 seconds
```

- Returns the full list of tasks for the current session
- App.tsx updates the task sidebar on each poll
- Polling stops for a task when it enters a terminal state (`completed`, `failed`, `cancelled`)

---

## SSE Streaming

The webview uses Server-Sent Events for real-time data in three places:

### 1. Task Creation Stream

```
POST /v1/tasks/stream
Body: { "request": "...", "piSessionId": "...", "bdsSessionId": "..." }
```

- Returns an SSE stream of model tokens as the AI generates a response
- Events: `ready`, `delta`, `reasoning_delta`, `status`, `tool`, `task`, `error`
- Used when the user sends their first message on a new task

### 2. Conversation Continuation

```
POST /v1/tasks/:id/stream
Body: { "request": "...", "piSessionId": "..." }
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

### Keepalive

All SSE connections send `:keepalive` comments every 15 seconds. The webview ignores these comments but uses them to detect connection drops.

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

### Storage Key

All conversations are stored in a single localStorage key:

```
intelacraft_chats_v1
```

This is a JSON object mapping task IDs to `ChatMsg[]` arrays. A separate key tracks the active chat:

```
intelacraft_active_chat
```

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
