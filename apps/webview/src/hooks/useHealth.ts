import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { ApiError, api, clearToken, getToken } from "../api";
import { createAuthorizedEventSource } from "../lib/stream";
import type {
  ActivityRecord,
  ChatMsg,
  Health,
  Provider,
  Task,
  ThinkingLevel,
  ToolRun,
} from "../types";

export function useHealth(deps: {
  authed: boolean;
  setAuthed: (authed: boolean) => void;
  setError: (error: string | null) => void;
  setHealth: Dispatch<SetStateAction<Health | null>>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setProviders: Dispatch<SetStateAction<Provider[]>>;
  setActivity: Dispatch<SetStateAction<ActivityRecord[]>>;
  setPermissionMode: (mode: string) => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
  setActiveProviderId: Dispatch<SetStateAction<string>>;
  tasksRef: MutableRefObject<Task[]>;
  chatRef: MutableRefObject<ChatMsg[]>;
  setProgressByTask: Dispatch<SetStateAction<Record<string, ToolRun>>>;
  setChat: Dispatch<SetStateAction<ChatMsg[]>>;
}) {
  const {
    authed,
    setAuthed,
    setError,
    setHealth,
    setTasks,
    setProviders,
    setActivity,
    setPermissionMode,
    setThinkingLevel,
    setActiveProviderId,
    tasksRef,
    chatRef,
    setProgressByTask,
    setChat,
  } = deps;

  const operationRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, t, p, a, s] = await Promise.all([
        api<Health>("/v1/health"),
        api<{ tasks: Task[] }>("/v1/tasks").catch(() => ({ tasks: [] as Task[] })),
        api<{ providers: Provider[]; activeProviderId?: string }>("/v1/providers").catch(() => ({
          providers: [] as Provider[],
          activeProviderId: "",
        })),
        api<{ records: ActivityRecord[] }>("/v1/activity?limit=80"),
        api<{ permissionMode: string; thinkingLevel?: ThinkingLevel; preferredThinkingLevel?: ThinkingLevel }>(
          "/v1/settings",
        ),
      ]);
      setHealth(h);
      setTasks(t.tasks);
      setProviders(p.providers);
      setActivity([...a.records].reverse());
      setPermissionMode(s.permissionMode);
      // `thinkingLevel` is the last session's effective (possibly clamped)
      // value. The selector represents the user's requested preference.
      if (s.preferredThinkingLevel) setThinkingLevel(s.preferredThinkingLevel);
      else if (s.thinkingLevel) setThinkingLevel(s.thinkingLevel);
      if (h.settings?.permissionMode) setPermissionMode(h.settings.permissionMode);
      if (h.settings?.preferredThinkingLevel) {
        setThinkingLevel(h.settings.preferredThinkingLevel as ThinkingLevel);
      } else if (h.settings?.thinkingLevel) {
        setThinkingLevel(h.settings.thinkingLevel as ThinkingLevel);
      }
      setActiveProviderId((prev) => {
        if (p.activeProviderId && p.providers.some((x) => x.id === p.activeProviderId)) {
          return p.activeProviderId;
        }
        if (prev && p.providers.some((x) => x.id === prev)) return prev;
        return p.providers[0]?.id ?? "";
      });
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearToken();
        setAuthed(false);
      }
      setError(e instanceof Error ? e.message : "Refresh failed");
    }
  }, [
    setActiveProviderId,
    setActivity,
    setAuthed,
    setError,
    setHealth,
    setPermissionMode,
    setProviders,
    setTasks,
    setThinkingLevel,
  ]);

  const refreshOperationalData = useCallback(async () => {
    const [t, a] = await Promise.all([
      api<{ tasks: Task[] }>("/v1/tasks").catch(() => ({ tasks: [] as Task[] })),
      api<{ records: ActivityRecord[] }>("/v1/activity?limit=80"),
    ]);
    setTasks(t.tasks);
    setActivity([...a.records].reverse());
  }, [setActivity, setTasks]);

  useEffect(() => {
    if (!authed) return;
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [authed, refresh]);

  useEffect(() => {
    if (!authed || !getToken()) return;
    const es = createAuthorizedEventSource("/v1/events/stream", getToken()!);
    es.addEventListener("operation", (ev: { data: string }) => {
      try {
        const record = JSON.parse(ev.data) as {
          event: ToolRun & { error?: { message?: string } };
        };
        const e = record.event;
        const run: ToolRun = {
          actionId: e.actionId,
          toolName: (e as { toolName?: string }).toolName,
          phase: String(e.actionId).includes("verify")
            ? "verify"
            : e.state === "running"
              ? "mutate"
              : "inspect",
          state: e.state,
          completedWork: e.completedWork,
          totalEstimatedWork: e.totalEstimatedWork,
          message: e.message,
          result: e.result,
          error: e.error?.message,
        };
        const taskId =
          tasksRef.current.find(
            (t) =>
              t.enqueuedActionIds?.includes(e.actionId) ||
              t.proposedActions?.some((a) => a.actionId === e.actionId),
          )?.id ??
          chatRef.current.find((m) => m.taskId && m.toolRuns?.some((r) => r.actionId === e.actionId))
            ?.taskId ??
          null;

        if (taskId) {
          setProgressByTask((prev) => ({ ...prev, [taskId]: run }));
          setChat((c) =>
            c.map((m) => {
              if (m.taskId !== taskId) return m;
              const rest = (m.toolRuns ?? []).filter((r) => r.actionId !== e.actionId);
              const terminalStates = ["completed", "failed", "partially_completed", "cancelled"];
              let parts = m.parts;
              if (terminalStates.includes(e.state)) {
                parts = (m.parts ?? []).map((p) =>
                  p.type === "tool_call" && p.state === "running" && p.name === (run.toolName ?? e.actionId)
                    ? {
                        ...p,
                        state: e.state as "completed" | "failed" | "partially_completed" | "cancelled",
                        progress: p.progress
                          ? { completed: p.progress.total, total: p.progress.total }
                          : undefined,
                      }
                    : p,
                );
              }
              return { ...m, toolRuns: [...rest, run], parts };
            }),
          );
        }
        if (operationRefreshRef.current) clearTimeout(operationRefreshRef.current);
        operationRefreshRef.current = setTimeout(() => {
          operationRefreshRef.current = null;
          void refreshOperationalData();
        }, 250);
      } catch {
        // ignore
      }
    });
    return () => {
      es.close();
      if (operationRefreshRef.current) clearTimeout(operationRefreshRef.current);
      operationRefreshRef.current = null;
    };
  }, [authed, chatRef, refreshOperationalData, setChat, setProgressByTask, tasksRef]);

  return { refresh, refreshOperationalData };
}
