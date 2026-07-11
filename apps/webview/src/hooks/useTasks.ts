import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { api } from "../api";
import {
  deleteConversation,
  setPersistedActiveChatId,
} from "../chatStore";
import { welcomeMsg } from "../lib/chat-helpers";
import type { ChatMsg, Task } from "../types";

export function useTasks(deps: {
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  setChat: Dispatch<SetStateAction<ChatMsg[]>>;
  tasksRef: MutableRefObject<Task[]>;
}) {
  const {
    setError,
    setBusy,
    refresh,
    selectedTaskId,
    setSelectedTaskId,
    activeConversationId,
    setActiveConversationId,
    setChat,
    tasksRef,
  } = deps;

  const [tasks, setTasks] = useState<Task[]>([]);
  const approvalInFlightRef = useRef<string | null>(null);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks, tasksRef]);

  const approveTask = useCallback(
    async (task: Task | null) => {
      if (!task) return;
      if (approvalInFlightRef.current === task.id) return;
      approvalInFlightRef.current = task.id;
      setBusy(true);
      setSelectedTaskId(task.id);
      try {
        const res = await api<{ task: Task }>(
          `/v1/tasks/${encodeURIComponent(task.id)}/approve`,
          { method: "POST", body: JSON.stringify({ approvedBy: "webview" }) },
        );
        setTasks((t) => [res.task, ...t.filter((x) => x.id !== res.task.id)]);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Approve failed");
      } finally {
        if (approvalInFlightRef.current === task.id) approvalInFlightRef.current = null;
        setBusy(false);
      }
    },
    [refresh, setBusy, setError, setSelectedTaskId],
  );

  const rejectTask = useCallback(
    async (task: Task | null) => {
      if (!task) return;
      setBusy(true);
      setSelectedTaskId(task.id);
      try {
        await api(`/v1/tasks/${encodeURIComponent(task.id)}/reject`, {
          method: "POST",
          body: JSON.stringify({ rejectedBy: "webview" }),
        });
        setChat((c) =>
          c.map((m) =>
            m.taskId === task.id ? { ...m, text: `${m.text}\n\nPlan rejected.` } : m,
          ),
        );
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reject failed");
      } finally {
        setBusy(false);
      }
    },
    [refresh, setBusy, setChat, setError, setSelectedTaskId],
  );

  const cancelTask = useCallback(
    async (task: Task | null) => {
      if (!task) return;
      setBusy(true);
      setSelectedTaskId(task.id);
      try {
        await api(`/v1/tasks/${encodeURIComponent(task.id)}/cancel`, {
          method: "POST",
          body: JSON.stringify({ cancelledBy: "webview" }),
        });
        setChat((c) =>
          c.map((m) =>
            m.taskId === task.id ? { ...m, text: `${m.text}\n\nCancelled.` } : m,
          ),
        );
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Cancel failed");
      } finally {
        setBusy(false);
      }
    },
    [refresh, setBusy, setChat, setError, setSelectedTaskId],
  );

  const editAndReplan = useCallback(
    async (task: Task) => {
      const notes = window.prompt("How should the plan change?", "Adjust bounds / block type / targets");
      if (!notes?.trim()) return;
      setBusy(true);
      setSelectedTaskId(task.id);
      try {
        const res = await api<{ task: Task }>(`/v1/tasks/${encodeURIComponent(task.id)}/replan`, {
          method: "POST",
          body: JSON.stringify({ notes: notes.trim() }),
        });
        setTasks((t) => [res.task, ...t.filter((x) => x.id !== res.task.id)]);
        setChat((c) =>
          c.map((m) =>
            m.taskId === task.id
              ? {
                  ...m,
                  text: res.task.plan?.summary ?? m.text,
                  parts: [
                    { type: "text", text: res.task.plan?.summary ?? m.text },
                    { type: "status", text: `Replanned (${res.task.state})` },
                  ],
                }
              : m,
          ),
        );
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Replan failed");
      } finally {
        setBusy(false);
      }
    },
    [refresh, setBusy, setChat, setError, setSelectedTaskId],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      try {
        await api(`/v1/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
        deleteConversation(id);
        if (selectedTaskId === id) {
          setSelectedTaskId(null);
          setChat([welcomeMsg()]);
        }
        if (activeConversationId === id) {
          setActiveConversationId(null);
          setPersistedActiveChatId(null);
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [
      activeConversationId,
      refresh,
      selectedTaskId,
      setActiveConversationId,
      setChat,
      setError,
      setSelectedTaskId,
    ],
  );

  return {
    tasks,
    setTasks,
    tasksRef,
    approveTask,
    rejectTask,
    cancelTask,
    editAndReplan,
    deleteTask,
  };
}
