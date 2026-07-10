import type { ChatMsg } from "./types";

const CHAT_STORE_KEY = "intelacraft_chats_v1";
const ACTIVE_CHAT_KEY = "intelacraft_active_chat";

type ChatStore = Record<string, ChatMsg[]>;

function readStore(): ChatStore {
  try {
    const raw = localStorage.getItem(CHAT_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ChatStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: ChatStore): void {
  try {
    localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(store));
  } catch {
    // quota / private mode — ignore
  }
}

export function getPersistedActiveChatId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CHAT_KEY);
  } catch {
    return null;
  }
}

export function setPersistedActiveChatId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_CHAT_KEY, id);
    else localStorage.removeItem(ACTIVE_CHAT_KEY);
  } catch {
    // ignore
  }
}

export function loadConversation(id: string): ChatMsg[] | null {
  const rows = readStore()[id];
  return Array.isArray(rows) && rows.length ? rows : null;
}

export function saveConversation(id: string, messages: ChatMsg[]): void {
  if (!id) return;
  const store = readStore();
  // Drop ephemeral streaming flags before persist.
  store[id] = messages
    .filter((m) => m.id !== "welcome")
    .map((m) => ({
      ...m,
      streaming: false,
      parts: m.parts?.map((p) =>
        p.type === "reasoning" ? { ...p, streaming: false } : p,
      ),
    }));
  writeStore(store);
  setPersistedActiveChatId(id);
}

export function deleteConversation(id: string): void {
  const store = readStore();
  delete store[id];
  writeStore(store);
  if (getPersistedActiveChatId() === id) setPersistedActiveChatId(null);
}

/** Build a minimal transcript from a task when no local copy exists. */
export function transcriptFromTask(task: {
  id: string;
  request: string;
  plan?: { summary?: string; notes?: string[] };
  error?: string;
  state: string;
  transcript?: Array<{ role: "user" | "assistant"; content: string }>;
}): ChatMsg[] {
  if (task.transcript?.length) {
    return task.transcript.map((t, i) => ({
      id: `restored_${task.id}_${i}`,
      role: t.role,
      text: t.content,
      taskId: t.role === "assistant" ? task.id : undefined,
      parts: t.role === "assistant" ? [{ type: "text" as const, text: t.content }] : undefined,
    }));
  }
  const msgs: ChatMsg[] = [
    {
      id: `restored_${task.id}_u`,
      role: "user",
      text: task.request.split("\n\nFollow-up:").slice(-1)[0]?.trim() || task.request,
    },
  ];
  const reply =
    task.error
      ? `Failed: ${task.error}`
      : task.plan?.summary ||
        (task.plan?.notes?.length ? task.plan.notes.join(" ") : `Task ${task.state}`);
  if (reply) {
    msgs.push({
      id: `restored_${task.id}_a`,
      role: "assistant",
      text: reply,
      taskId: task.id,
      parts: [{ type: "text", text: reply }],
    });
  }
  return msgs;
}
