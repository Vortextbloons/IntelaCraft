import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { api } from "../api";
import {
  deleteConversation,
  getPersistedActiveChatId,
  loadConversation,
  saveConversation,
  setPersistedActiveChatId,
  transcriptFromTask,
} from "../chatStore";
import { welcomeMsg } from "../lib/chat-helpers";
import type { ChatMsg, Task } from "../types";

export function useConversations(deps: {
  authed: boolean;
  tasksRef: MutableRefObject<Task[]>;
  setError: (error: string | null) => void;
  setStickToBottom: (stick: boolean) => void;
  setAiMode: (mode: "ask" | "agent") => void;
  streamAbortRef: MutableRefObject<AbortController | null>;
  updatePiSessionId: (id: string | null) => void;
  setProgressByTask: Dispatch<SetStateAction<Record<string, import("../types").ToolRun>>>;
  setPrompt: (prompt: string) => void;
}) {
  const {
    authed,
    tasksRef,
    setError,
    setStickToBottom,
    setAiMode,
    streamAbortRef,
    updatePiSessionId,
    setProgressByTask,
    setPrompt,
  } = deps;

  const [chat, setChat] = useState<ChatMsg[]>([welcomeMsg()]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const chatRef = useRef<ChatMsg[]>(chat);

  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  // Persist the open conversation whenever the transcript changes.
  useEffect(() => {
    if (!activeConversationId) return;
    if (chat.some((m) => m.streaming)) return;
    const meaningful = chat.filter((m) => m.id !== "welcome");
    if (!meaningful.length) return;
    saveConversation(activeConversationId, chat);
  }, [chat, activeConversationId]);

  const openConversation = useCallback(async (taskId: string) => {
    setSelectedTaskId(taskId);
    setActiveConversationId(taskId);
    const knownTask = tasksRef.current.find((task) => task.id === taskId);
    if (knownTask?.mode) setAiMode(knownTask.mode);
    setPersistedActiveChatId(taskId);
    setError(null);
    setStickToBottom(true);

    const local = loadConversation(taskId);
    if (local?.length) {
      setChat(local);
      return;
    }

    try {
      const res = await api<{
        task: Task;
        transcript?: Array<{ role: "user" | "assistant"; content: string }>;
      }>(`/v1/tasks/${encodeURIComponent(taskId)}`);
      const msgs = transcriptFromTask({
        ...res.task,
        transcript: res.transcript,
      });
      setChat(msgs.length ? msgs : [welcomeMsg()]);
      if (msgs.length) saveConversation(taskId, msgs);
    } catch {
      const t = tasksRef.current.find((x) => x.id === taskId);
      if (t) {
        const msgs = transcriptFromTask(t);
        setChat(msgs);
        saveConversation(taskId, msgs);
      } else {
        setChat([welcomeMsg()]);
      }
    }
  }, [setAiMode, setError, setStickToBottom, tasksRef]);

  // After login / refresh, restore the last open thread.
  useEffect(() => {
    if (!authed) return;
    const id = getPersistedActiveChatId();
    if (!id) return;
    void openConversation(id);
  }, [authed, openConversation]);

  const startNewChat = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    if (activeConversationId) {
      saveConversation(activeConversationId, chatRef.current);
    }
    setChat([welcomeMsg()]);
    setSelectedTaskId(null);
    setActiveConversationId(null);
    setPersistedActiveChatId(null);
    setProgressByTask({});
    updatePiSessionId(null);
    setPrompt("");
    setError(null);
  }, [
    activeConversationId,
    setError,
    setProgressByTask,
    setPrompt,
    setStickToBottom,
    streamAbortRef,
    updatePiSessionId,
  ]);

  return {
    chat,
    setChat,
    chatRef,
    selectedTaskId,
    setSelectedTaskId,
    activeConversationId,
    setActiveConversationId,
    openConversation,
    startNewChat,
  };
}

export function useSelectedTask(tasks: Task[], selectedTaskId: string | null) {
  return useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );
}
