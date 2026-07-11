import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from "react";
import { ApiError, api, getToken } from "../api";
import { saveConversation, setPersistedActiveChatId } from "../chatStore";
import { uid } from "../lib/chat-helpers";
import { createStreamUpdateQueue, upsertToolPart } from "../lib/stream";
import { isReadOnlyPlan, taskNeedsPlanCard, type MessagePart } from "../types";
import type { ChatMsg, Health, Task } from "../types";
import { formatInspectResult } from "../utils/format";

export function useChatStream(deps: {
  chat: ChatMsg[];
  setChat: Dispatch<SetStateAction<ChatMsg[]>>;
  chatRef: MutableRefObject<ChatMsg[]>;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  health: Health | null;
  aiMode: "ask" | "agent";
  permissionMode: string;
  piSessionId: string | null;
  activeProviderId: string;
  ensurePiSession: (providerId?: string) => Promise<string>;
  refresh: () => Promise<void>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setError: (error: string | null) => void;
  setStickToBottom: (stick: boolean) => void;
  pickerPanel: "none" | "providers" | "models" | "reasoning";
  setPickerPanel: (panel: "none" | "providers" | "models" | "reasoning") => void;
  streamAbortRef: MutableRefObject<AbortController | null>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const {
    chat,
    setChat,
    chatRef,
    activeConversationId,
    setActiveConversationId,
    setSelectedTaskId,
    health,
    aiMode,
    permissionMode,
    piSessionId,
    activeProviderId,
    ensurePiSession,
    refresh,
    setTasks,
    setError,
    setStickToBottom,
    pickerPanel,
    setPickerPanel,
    streamAbortRef,
    busy,
    setBusy,
  } = deps;

  const [prompt, setPrompt] = useState("");

  const { flushStreamUpdates, queueStreamUpdate } = createStreamUpdateQueue(setChat);

  const updateAssistant = useCallback(
    (assistantId: string, patch: Partial<ChatMsg> | ((m: ChatMsg) => ChatMsg)) => {
      setChat((c) =>
        c.map((m) => {
          if (m.id !== assistantId) return m;
          return typeof patch === "function" ? patch(m) : { ...m, ...patch };
        }),
      );
    },
    [setChat],
  );

  const stopStreaming = useCallback(() => {
    flushStreamUpdates();
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setBusy(false);
    setChat((c) =>
      c.map((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              parts: (m.parts ?? []).map((p) =>
                p.type === "reasoning" ? { ...p, streaming: false } : p,
              ),
              text: m.text || "Stopped.",
            }
          : m,
      ),
    );
  }, [flushStreamUpdates, setChat, streamAbortRef]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        if (pickerPanel !== "none") {
          ev.preventDefault();
          setPickerPanel("none");
          return;
        }
        if (busy) {
          ev.preventDefault();
          stopStreaming();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, pickerPanel, setPickerPanel, stopStreaming]);

  const submitTask = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      // Do not rely on the disabled button alone; submit events can still be
      // triggered programmatically or race with a state update.
      if (busy) return;
      if (!prompt.trim()) return;
      if (!health?.bdsConnected) {
        setError(
          "Bedrock (BDS) is not connected. Start your Minecraft Dedicated Server with the IntelaCraft packs, then try again.",
        );
        return;
      }
      streamAbortRef.current?.abort();
      const abort = new AbortController();
      streamAbortRef.current = abort;
      setBusy(true);
      setError(null);
      setStickToBottom(true);
      const text = prompt.trim();
      setPrompt("");
      const assistantId = uid();
      setChat((c) => {
        const prior =
          activeConversationId != null
            ? c.map((m) =>
                m.taskId === activeConversationId ? { ...m, taskId: undefined } : m,
              )
            : c;
        return [
          ...prior,
          { id: uid(), role: "user", text },
          {
            id: assistantId,
            role: "assistant",
            text: "",
            streaming: true,
            parts: [{ type: "status", text: "Planning…" }],
          },
        ];
      });
      setSelectedTaskId(null);
      let streamedText = "";
      let reasoningText = "";
      try {
        let session = piSessionId;
        if (!session) {
          if (!activeProviderId) {
            throw new Error("Connect a provider first (Providers menu)");
          }
          session = await ensurePiSession(activeProviderId);
        }
        const token = getToken();
        if (!token) throw new Error("Not signed in");
        const worldContext = {
          playersOnline: health.sessions?.[0]?.health?.playerCount,
          serverId: health.sessions?.[0]?.serverId,
          tick: health.sessions?.[0]?.health?.tick,
        };
        const historyPayload = chat
          .filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              m.id !== assistantId &&
              m.text.trim() &&
              m.id !== "welcome",
          )
          .slice(-16)
          .flatMap((m) => {
            const content =
              m.parts?.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("") ||
              m.text;
            const turns: Array<{ role: "user" | "assistant"; content: string }> = [
              { role: m.role as "user" | "assistant", content },
            ];
            for (const run of m.toolRuns ?? []) {
              if (run.state === "completed" || run.state === "failed") {
                turns.push({
                  role: "assistant",
                  content: `[tool result] ${
                    run.error
                      ? `Failed: ${run.error}`
                      : formatInspectResult(run.message || run.state, run.result)
                  }`,
                });
              }
            }
            return turns;
          });
        const isContinue = Boolean(activeConversationId);
        const streamUrl = isContinue
          ? `/v1/tasks/${encodeURIComponent(activeConversationId!)}/stream`
          : "/v1/tasks/stream";
        const streamBody = isContinue
          ? JSON.stringify({
              request: text,
              mode: aiMode,
              useMcp: true,
              worldContext,
              history: historyPayload,
            })
          : JSON.stringify({
              piSessionId: session,
              request: text,
              mode: aiMode,
              permissionMode,
              useMcp: true,
              worldContext,
              history: historyPayload,
            });
        const res = await fetch(streamUrl, {
          method: "POST",
          signal: abort.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          body: streamBody,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new ApiError(
            res.status,
            body?.error?.code ?? "HTTP_ERROR",
            body?.error?.message ?? `Request failed (${res.status})`,
            body,
          );
        }
        if (!res.body) throw new Error("No stream from controller");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventName = "message";
        let finalTask: Task | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (!data) continue;
              let parsed: Record<string, unknown> = {};
              try {
                parsed = JSON.parse(data);
              } catch {
                continue;
              }
              if (eventName === "delta" && typeof parsed.text === "string") {
                const deltaText = parsed.text;
                streamedText += deltaText;
                queueStreamUpdate(assistantId, (m) => {
                  const parts = [...(m.parts ?? [])].filter((p) => p.type !== "status");
                  const last = parts.at(-1);
                  if (last?.type === "text") {
                    parts[parts.length - 1] = { type: "text", text: last.text + deltaText };
                  } else {
                    parts.push({ type: "text", text: deltaText });
                  }
                  return {
                    ...m,
                    text: streamedText,
                    streaming: true,
                    parts,
                  };
                });
              } else if (eventName === "reasoning_delta" && typeof parsed.text === "string") {
                reasoningText += parsed.text;
                queueStreamUpdate(assistantId, (m) => {
                  const parts = [...(m.parts ?? [])];
                  const last = parts.at(-1);
                  if (last?.type === "reasoning") {
                    parts[parts.length - 1] = {
                      type: "reasoning",
                      text: reasoningText,
                      streaming: true,
                    };
                  } else {
                    parts.push({ type: "reasoning", text: reasoningText, streaming: true });
                  }
                  return {
                    ...m,
                    parts,
                  };
                });
              } else if (eventName === "status" && typeof parsed.text === "string") {
                const statusText = parsed.text;
                flushStreamUpdates();
                updateAssistant(assistantId, (m) => ({
                  ...m,
                  parts: [
                    ...(m.parts ?? []).filter((p) => p.type !== "status"),
                    { type: "status", text: statusText },
                  ],
                }));
              } else if (eventName === "tool") {
                flushStreamUpdates();
                const toolCallId =
                  typeof parsed.toolCallId === "string" && parsed.toolCallId
                    ? parsed.toolCallId
                    : undefined;
                const name = String(parsed.name ?? "tool");
                const id = toolCallId || name;
                const ended = parsed.phase === "end";
                const failed = ended && Boolean(parsed.isError);
                updateAssistant(assistantId, (m) => ({
                  ...m,
                  parts: upsertToolPart(m.parts, {
                    type: "tool_call",
                    id,
                    name,
                    phase: "plan",
                    state: failed ? "failed" : ended ? "completed" : "running",
                    resultText:
                      ended && !failed && typeof parsed.detail === "string"
                        ? parsed.detail
                        : undefined,
                    error: failed
                      ? String(parsed.detail ?? parsed.message ?? "Tool failed")
                      : undefined,
                  }),
                }));
              } else if (eventName === "task" && parsed.task) {
                finalTask = parsed.task as Task;
              } else if (eventName === "error") {
                throw new Error(String(parsed.message ?? "Planning failed"));
              }
            } else if (!line.trim()) {
              eventName = "message";
            }
          }
        }

        if (!finalTask) throw new Error("Stream ended without a task");
        flushStreamUpdates();
        if (finalTask.state === "planned" && isReadOnlyPlan(finalTask)) {
          try {
            const kicked = await api<{ task: Task }>(
              `/v1/tasks/${encodeURIComponent(finalTask.id)}/approve`,
              { method: "POST", body: JSON.stringify({ approvedBy: "webview-auto" }) },
            );
            finalTask = kicked.task;
          } catch {
            // leave planned
          }
        }
        setTasks((t) => [finalTask!, ...t.filter((x) => x.id !== finalTask!.id)]);
        const reply = finalTask.error
          ? `Failed: ${finalTask.error}`
          : finalTask.plan?.summary || streamedText || `Done (${finalTask.state})`;
        updateAssistant(assistantId, (m) => {
          const parts: MessagePart[] = (m.parts ?? [])
            .filter((part) => part.type !== "status")
            .map((part) =>
              part.type === "reasoning" ? { ...part, streaming: false } : part,
            );
          const last = parts.at(-1);
          if (last?.type !== "text" || last.text !== reply) {
            parts.push({ type: "text", text: reply });
          }
          if (finalTask!.state === "inspecting") {
            parts.push({ type: "status", text: "Inspecting world…" });
          } else if (finalTask!.state === "awaiting_approval") {
            parts.push({ type: "status", text: "Waiting for approval" });
          }
          const next = {
            ...m,
            text: reply,
            taskId: finalTask!.id,
            streaming: false,
            parts,
          };
          saveConversation(
            finalTask!.id,
            chatRef.current.map((row) => (row.id === assistantId ? next : row)),
          );
          return next;
        });
        if (taskNeedsPlanCard(finalTask)) setSelectedTaskId(finalTask.id);
        else setSelectedTaskId(null);
        setActiveConversationId(finalTask.id);
        setPersistedActiveChatId(finalTask.id);
        await refresh();
      } catch (err) {
        if (abort.signal.aborted) {
          updateAssistant(assistantId, {
            text: streamedText || "Stopped.",
            streaming: false,
          });
          return;
        }
        const msg =
          err instanceof ApiError && err.code === "NO_SESSION"
            ? "Bedrock (BDS) is not connected. Start the dedicated server with IntelaCraft packs loaded."
            : err instanceof Error
              ? err.message
              : "Task failed";
        setError(msg);
        updateAssistant(assistantId, {
          text: msg,
          streaming: false,
          parts: [{ type: "text", text: msg }],
        });
      } finally {
        if (streamAbortRef.current === abort) streamAbortRef.current = null;
        setBusy(false);
      }
    },
    [
      activeConversationId,
      activeProviderId,
      aiMode,
      chat,
      chatRef,
      ensurePiSession,
      flushStreamUpdates,
      health,
      permissionMode,
      piSessionId,
      prompt,
      queueStreamUpdate,
      refresh,
      setActiveConversationId,
      setChat,
      setError,
      setSelectedTaskId,
      setStickToBottom,
      setTasks,
      streamAbortRef,
      updateAssistant,
    ],
  );

  return {
    prompt,
    setPrompt,
    submitTask,
    stopStreaming,
  };
}
