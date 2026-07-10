import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, api, clearToken, getToken, setToken } from "./api";

type Health = {
  ok: boolean;
  bdsConnected: boolean;
  sessions: Array<{
    sessionId: string;
    serverId: string;
    connected: boolean;
    emergencyDisabled?: boolean;
    health?: { playerCount?: number };
  }>;
  settings?: { permissionMode: string };
  agent?: {
    pi: boolean;
    sessions: number;
    providers: number;
    mcp?: { configured?: boolean; available?: boolean };
  };
};

type Task = {
  id: string;
  request: string;
  state: string;
  plan?: { summary: string; notes?: string[] };
  proposedActions?: Array<{
    actionId: string;
    toolName: string;
    risk: string;
    arguments: Record<string, unknown>;
  }>;
  error?: string;
};

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
};

type ActivityRecord = {
  loggedAt: string;
  type: string;
  taskId?: string;
  actionId?: string;
  message?: string;
  state?: string;
  risk?: string;
  toolName?: string;
};

type ChatMsg = { role: "user" | "system" | "assistant"; text: string };

type Progress = {
  actionId: string;
  state: string;
  completedWork: number;
  totalEstimatedWork: number;
  message: string;
};

const MODES = [
  "observe_only",
  "confirm_every_change",
  "allow_low_risk",
  "builder_region",
  "trusted_administrator",
] as const;

export function App() {
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([
    {
      role: "system",
      text: "Connected to IntelaCraft control panel. Configure a provider, start a Pi session, then ask for a world task.",
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [piSessionId, setPiSessionId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [activityFilter, setActivityFilter] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [permissionMode, setPermissionMode] = useState("confirm_every_change");
  const [providerForm, setProviderForm] = useState({
    id: "default",
    name: "Default",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
  });
  const [busy, setBusy] = useState(false);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? tasks[0] ?? null,
    [tasks, selectedTaskId],
  );

  const refresh = useCallback(async () => {
    try {
      const [h, t, p, a, s] = await Promise.all([
        api<Health>("/v1/health"),
        api<{ tasks: Task[] }>("/v1/tasks").catch(() => ({ tasks: [] as Task[] })),
        api<{ providers: Provider[] }>("/v1/providers").catch(() => ({
          providers: [] as Provider[],
        })),
        api<{ records: ActivityRecord[] }>("/v1/activity?limit=80"),
        api<{ permissionMode: string }>("/v1/settings"),
      ]);
      setHealth(h);
      setTasks(t.tasks);
      setProviders(p.providers);
      setActivity([...a.records].reverse());
      setPermissionMode(s.permissionMode);
      if (h.settings?.permissionMode) setPermissionMode(h.settings.permissionMode);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearToken();
        setAuthed(false);
      }
      setError(e instanceof Error ? e.message : "Refresh failed");
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [authed, refresh]);

  useEffect(() => {
    if (!authed || !getToken()) return;
    const es = createAuthorizedEventSource("/v1/events/stream", getToken()!);
    es.addEventListener("operation", (ev: { data: string }) => {
      try {
        const record = JSON.parse(ev.data) as {
          event: Progress & { actionId: string };
        };
        const e = record.event;
        setProgress({
          actionId: e.actionId,
          state: e.state,
          completedWork: e.completedWork,
          totalEstimatedWork: e.totalEstimatedWork,
          message: e.message,
        });
        void refresh();
      } catch {
        // ignore
      }
    });
    return () => es.close();
  }, [authed, refresh]);

  async function login(e: FormEvent) {
    e.preventDefault();
    setToken(tokenInput.trim());
    try {
      await api("/v1/health");
      // health is public; verify token with settings
      await api("/v1/settings");
      setAuthed(true);
      setError(null);
    } catch (err) {
      clearToken();
      setAuthed(false);
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  async function saveProvider() {
    setBusy(true);
    try {
      await api("/v1/providers", {
        method: "POST",
        body: JSON.stringify({
          id: providerForm.id,
          name: providerForm.name,
          baseUrl: providerForm.baseUrl,
          model: providerForm.model,
          apiKey: providerForm.apiKey,
        }),
      });
      setProviderForm((f) => ({ ...f, apiKey: "" }));
      setChat((c) => [
        ...c,
        { role: "system", text: `Provider '${providerForm.id}' saved (key stored server-side).` },
      ]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save provider failed");
    } finally {
      setBusy(false);
    }
  }

  async function testProvider() {
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; model: string }>(
        `/v1/providers/${encodeURIComponent(providerForm.id)}/test`,
        { method: "POST", body: "{}" },
      );
      setChat((c) => [
        ...c,
        { role: "system", text: `Provider test OK — model ${result.model}.` },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provider test failed");
    } finally {
      setBusy(false);
    }
  }

  async function startPi() {
    setBusy(true);
    try {
      const res = await api<{ session: { id: string } }>("/v1/pi/sessions", {
        method: "POST",
        body: JSON.stringify({ providerId: providerForm.id }),
      });
      setPiSessionId(res.session.id);
      setChat((c) => [
        ...c,
        { role: "system", text: `Pi session ${res.session.id} ready.` },
      ]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pi session failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitTask(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!piSessionId) {
      setError("Start a Pi session first");
      return;
    }
    setBusy(true);
    const text = prompt.trim();
    setPrompt("");
    setChat((c) => [...c, { role: "user", text }]);
    try {
      const res = await api<{ task: Task }>("/v1/tasks", {
        method: "POST",
        body: JSON.stringify({
          piSessionId,
          request: text,
          permissionMode,
          useMcp: true,
        }),
      });
      setSelectedTaskId(res.task.id);
      setChat((c) => [
        ...c,
        {
          role: "assistant",
          text: res.task.error
            ? `Task failed: ${res.task.error}`
            : `Plan (${res.task.state}): ${res.task.plan?.summary ?? "ready"}`,
        },
      ]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task failed");
    } finally {
      setBusy(false);
    }
  }

  async function approveTask() {
    if (!selectedTask) return;
    setBusy(true);
    try {
      const res = await api<{ task: Task }>(
        `/v1/tasks/${encodeURIComponent(selectedTask.id)}/approve`,
        { method: "POST", body: JSON.stringify({ approvedBy: "webview" }) },
      );
      setChat((c) => [
        ...c,
        { role: "system", text: `Approved task ${res.task.id} → ${res.task.state}` },
      ]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function rejectTask() {
    if (!selectedTask) return;
    setBusy(true);
    try {
      await api(`/v1/tasks/${encodeURIComponent(selectedTask.id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ rejectedBy: "webview" }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancelTask() {
    if (!selectedTask) return;
    setBusy(true);
    try {
      await api(`/v1/tasks/${encodeURIComponent(selectedTask.id)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancelledBy: "webview" }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  async function emergency(disabled: boolean) {
    setBusy(true);
    try {
      await api("/v1/emergency-disable", {
        method: "POST",
        body: JSON.stringify({ disabled, actor: "webview" }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Emergency toggle failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchMode(mode: string) {
    setBusy(true);
    try {
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ permissionMode: mode }),
      });
      setPermissionMode(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings update failed");
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <div className="login-gate">
        <form className="login-panel stack" onSubmit={login}>
          <h1>IntelaCraft</h1>
          <p>Enter the controller bearer token to open the control panel.</p>
          <label>
            Bearer token
            <input
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              required
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" type="submit">
            Enter
          </button>
        </form>
      </div>
    );
  }

  const mcp = health?.agent?.mcp;
  const emergencyOn = health?.sessions?.some((s) => s.emergencyDisabled);

  const filteredActivity = activityFilter
    ? activity.filter(
        (r) =>
          r.type.includes(activityFilter) ||
          r.taskId?.includes(activityFilter) ||
          r.actionId?.includes(activityFilter),
      )
    : activity;

  const progressPct =
    progress && progress.totalEstimatedWork > 0
      ? Math.min(100, Math.round((progress.completedWork / progress.totalEstimatedWork) * 100))
      : 0;

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <div>
          <h1>IntelaCraft</h1>
          <p>Bedrock control panel — approve, watch, and audit world changes.</p>
        </div>
        <div className="status-row" role="status" aria-live="polite">
          <StatusPill
            label="Controller"
            state="ok"
            detail="localhost"
          />
          <StatusPill
            label="BDS"
            state={health?.bdsConnected ? "ok" : "bad"}
            detail={health?.bdsConnected ? "connected" : "offline"}
          />
          <StatusPill
            label="Pi"
            state={health?.agent?.pi && (health.agent.sessions > 0 || piSessionId) ? "ok" : "warn"}
            detail={piSessionId ? "session" : `${health?.agent?.sessions ?? 0} sess`}
          />
          <StatusPill
            label="Model"
            state={providers.length ? "ok" : "warn"}
            detail={`${providers.length} profile(s)`}
          />
          <StatusPill
            label="MCP"
            state={mcp?.available ? "ok" : mcp?.configured ? "warn" : "bad"}
            detail={mcp?.available ? "up" : mcp?.configured ? "down" : "off"}
          />
          <button
            className="ghost"
            type="button"
            onClick={() => {
              clearToken();
              setAuthed(false);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="layout">
        <section className="stack">
          <div className="panel">
            <h2>Chat &amp; tasks</h2>
            <div className="chat-log" aria-live="polite">
              {chat.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.text}
                </div>
              ))}
            </div>
            <form className="stack" onSubmit={submitTask}>
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask for an inspection or bounded build…"
              />
              <div className="row">
                <button className="primary" type="submit" disabled={busy}>
                  Plan task
                </button>
                <button type="button" disabled={busy || !selectedTask} onClick={() => void cancelTask()}>
                  Cancel task
                </button>
              </div>
            </form>
          </div>

          <div className="panel">
            <h2>Plan &amp; approval</h2>
            {!selectedTask ? (
              <p className="meta">No task selected yet.</p>
            ) : (
              <div className="stack">
                <div className="meta">
                  {selectedTask.id} · <strong>{selectedTask.state}</strong>
                </div>
                <p>{selectedTask.plan?.summary ?? selectedTask.error ?? "—"}</p>
                {(selectedTask.proposedActions ?? []).map((a) => (
                  <div
                    key={a.actionId}
                    className={`action-card ${a.risk === "strong" ? "strong" : ""}`}
                  >
                    <strong>{a.toolName}</strong>
                    <div className="meta">
                      risk {a.risk} · {a.actionId}
                    </div>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.75rem" }}>
                      {JSON.stringify(a.arguments, null, 2)}
                    </pre>
                  </div>
                ))}
                <div className="row">
                  <button
                    className="primary"
                    type="button"
                    disabled={
                      busy ||
                      !["awaiting_approval", "planned"].includes(selectedTask.state)
                    }
                    onClick={() => void approveTask()}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !["awaiting_approval", "planned"].includes(selectedTask.state)
                    }
                    onClick={() => void rejectTask()}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Batch progress</h2>
            {!progress ? (
              <p className="meta">Waiting for operation events…</p>
            ) : (
              <div className="stack">
                <div className="meta">
                  {progress.actionId} · {progress.state}
                </div>
                <div className="progress-bar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${progressPct}%` }} />
                </div>
                <div>
                  {progress.completedWork}/{progress.totalEstimatedWork} — {progress.message}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="stack">
          <div className="panel">
            <h2>Providers</h2>
            <div className="stack">
              <label>
                Profile id
                <input
                  value={providerForm.id}
                  onChange={(e) => setProviderForm({ ...providerForm, id: e.target.value })}
                />
              </label>
              <label>
                Base URL
                <input
                  value={providerForm.baseUrl}
                  onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
                />
              </label>
              <label>
                Model
                <input
                  value={providerForm.model}
                  onChange={(e) => setProviderForm({ ...providerForm, model: e.target.value })}
                />
              </label>
              <label>
                API key {providers.find((p) => p.id === providerForm.id)?.apiKeyConfigured ? "(configured — leave blank to keep)" : ""}
                <input
                  type="password"
                  autoComplete="off"
                  value={providerForm.apiKey}
                  placeholder={
                    providers.find((p) => p.id === providerForm.id)?.apiKeyConfigured
                      ? "••••••••"
                      : ""
                  }
                  onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                />
              </label>
              <div className="row">
                <button type="button" className="primary" disabled={busy} onClick={() => void saveProvider()}>
                  Save
                </button>
                <button type="button" disabled={busy} onClick={() => void testProvider()}>
                  Test
                </button>
                <button type="button" disabled={busy} onClick={() => void startPi()}>
                  Start Pi
                </button>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Safety</h2>
            <div className="stack">
              <label>
                Permission mode
                <select
                  value={permissionMode}
                  onChange={(e) => void patchMode(e.target.value)}
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button
                  className="danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void emergency(true)}
                >
                  Emergency disable
                </button>
                <button type="button" disabled={busy || !emergencyOn} onClick={() => void emergency(false)}>
                  Clear disable
                </button>
              </div>
              {emergencyOn && <div className="error">Emergency disable is active</div>}
            </div>
          </div>

          <div className="panel">
            <h2>Activity history</h2>
            <input
              placeholder="Filter by type / task / action…"
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              aria-label="Filter activity"
            />
            <div className="activity-list" style={{ marginTop: "0.75rem" }}>
              {filteredActivity.map((r, i) => (
                <div key={`${r.loggedAt}-${i}`} className="activity-item">
                  <div>
                    <strong>{r.type}</strong> · {new Date(r.loggedAt).toLocaleTimeString()}
                  </div>
                  <div className="meta">
                    {[r.taskId, r.actionId, r.toolName, r.risk, r.state, r.message]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  state,
  detail,
}: {
  label: string;
  state: "ok" | "warn" | "bad";
  detail: string;
}) {
  return (
    <span className="pill">
      <span className={`dot ${state}`} aria-hidden />
      <span>
        {label}: {detail}
      </span>
    </span>
  );
}

/** Fetch-based SSE client (native EventSource cannot set Authorization). */
function createAuthorizedEventSource(url: string, token: string) {
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
      // closed or aborted
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
