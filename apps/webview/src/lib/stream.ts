import type { Dispatch, SetStateAction } from "react";
import type { ChatMsg, MessagePart } from "../types";

export function createAuthorizedEventSource(url: string, token: string) {
  const controller = new AbortController();
  const listeners = new Map<string, Set<(ev: { data: string }) => void>>();

  void (async () => {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "message";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            const set = listeners.get(eventName);
            if (set) {
              for (const fn of set) fn({ data });
            }
            eventName = "message";
          }
        }
      }
    } catch {
      // closed
    }
  })();

  return {
    addEventListener(type: string, fn: (ev: { data: string }) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    close() {
      controller.abort();
    },
  };
}

export function upsertToolPart(
  parts: MessagePart[] | undefined,
  part: Extract<MessagePart, { type: "tool_call" }>,
) {
  const list = [...(parts ?? [])];
  let idx = list.findIndex((p) => p.type === "tool_call" && p.id === part.id);
  // Fall back: match the latest running card with the same tool name.
  if (idx < 0 && part.state === "completed") {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.type === "tool_call" && p.name === part.name && p.state === "running") {
        idx = i;
        break;
      }
    }
  }
  if (idx >= 0) {
    const prev = list[idx] as Extract<MessagePart, { type: "tool_call" }>;
    list[idx] = {
      ...prev,
      ...part,
      id: prev.id,
      argsSummary: part.argsSummary ?? prev.argsSummary,
    };
  } else {
    list.push(part);
  }
  return list;
}

export type StreamUpdate = {
  assistantId: string;
  patch: Partial<ChatMsg> | ((message: ChatMsg) => ChatMsg);
};

export function createStreamUpdateQueue(setChat: Dispatch<SetStateAction<ChatMsg[]>>) {
  const streamUpdateFrameRef = { current: null as number | null };
  const pendingStreamUpdatesRef = { current: [] as StreamUpdate[] };

  function flushStreamUpdates() {
    if (streamUpdateFrameRef.current !== null) {
      cancelAnimationFrame(streamUpdateFrameRef.current);
      streamUpdateFrameRef.current = null;
    }
    const updates = pendingStreamUpdatesRef.current.splice(0);
    if (!updates.length) return;
    setChat((chat) => {
      let next = chat;
      for (const { assistantId, patch } of updates) {
        next = next.map((message) =>
          message.id !== assistantId
            ? message
            : typeof patch === "function"
              ? patch(message)
              : { ...message, ...patch },
        );
      }
      return next;
    });
  }

  function queueStreamUpdate(
    assistantId: string,
    patch: Partial<ChatMsg> | ((message: ChatMsg) => ChatMsg),
  ) {
    pendingStreamUpdatesRef.current.push({ assistantId, patch });
    if (streamUpdateFrameRef.current === null) {
      streamUpdateFrameRef.current = requestAnimationFrame(flushStreamUpdates);
    }
  }

  return { flushStreamUpdates, queueStreamUpdate };
}
