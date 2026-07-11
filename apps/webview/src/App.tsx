import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, api, clearPiSessionId, clearToken, getPiSessionId, getToken, setPiSessionId, setToken } from "./api";
import { ConnectionStrip } from "./components/ConnectionStrip";
import { Transcript } from "./components/Transcript";
import { WorldContextPanel } from "./components/WorldContextPanel";
import {
  deleteConversation,
  getPersistedActiveChatId,
  loadConversation,
  saveConversation,
  setPersistedActiveChatId,
  transcriptFromTask,
} from "./chatStore";
import {
  isReadOnlyPlan,
  taskNeedsPlanCard,
  THINKING_LEVELS,
  THINKING_LEVEL_LABELS,
  type ActivityRecord,
  type ChatMsg,
  type DiscoveredModel,
  type Health,
  type MessagePart,
  type Provider,
  type ReasoningCapabilities,
  type Task,
  type ThinkingLevel,
  type ToolRun,
} from "./types";
import { formatInspectResult, summarizeArgs } from "./utils/format";

const MODES = [
  "observe_only",
  "confirm_every_change",
  "allow_low_risk",
  "builder_region",
  "trusted_administrator",
] as const;

const PROVIDER_PRESETS = [
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    model: "gpt-5.4-mini",
    hint: "Paste key from opencode.ai/auth — models auto-load",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    model: "qwen3-coder",
    hint: "OpenCode Go subscription models",
  },
  {
    id: "openai",
    name: "OpenAI / Codex",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hint: "OpenAI API key — Codex-capable chat models preferred",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4.1-mini",
    hint: "OpenRouter key — many Codex-style models",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    hint: "Fast open models",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    hint: "Local — no key needed (use any string)",
  },
  {
    id: "custom",
    name: "Custom OpenAI-compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "local-model",
    hint: "Any /v1 chat-completions gateway",
  },
] as const;

const WELCOME_TEXT =
  "New session. Connect a provider in the composer, pick a model from its catalog, then chat.";

function uid(prefix = "msg") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function welcomeMsg(): ChatMsg {
  return { id: "welcome", role: "system", text: WELCOME_TEXT };
}

export function App() {
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([welcomeMsg()]);
  const [prompt, setPrompt] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>("");
  const [piSessionId, setPiSessionIdState] = useState<string | null>(getPiSessionId);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, DiscoveredModel[]>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [browseProviderId, setBrowseProviderId] = useState("opencode-zen");
  const [connectKey, setConnectKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showKeyUpdate, setShowKeyUpdate] = useState(false);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [activityFilter, setActivityFilter] = useState("");
  const [progressByTask, setProgressByTask] = useState<Record<string, ToolRun>>({});
  const [permissionMode, setPermissionMode] = useState("confirm_every_change");
  const [pickerPanel, setPickerPanel] = useState<"none" | "providers" | "models" | "reasoning">("none");
  const [modelFilter, setModelFilter] = useState("");
  const [drawer, setDrawer] = useState<"none" | "safety" | "activity">("none");
  const [busy, setBusy] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("minimal");
  const [modelCapabilities, setModelCapabilities] = useState<ReasoningCapabilities>({
    supported: false,
    levels: ["off"],
    preferredLevel: "off",
    source: "unknown",
  });
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamUpdateFrameRef = useRef<number | null>(null);
  const pendingStreamUpdatesRef = useRef<Array<{
    assistantId: string;
    patch: Partial<ChatMsg> | ((message: ChatMsg) => ChatMsg);
  }>>([]);
  const scrollFrameRef = useRef<number | null>(null);
  const operationRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasoningModelRef = useRef<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const tasksRef = useRef<Task[]>([]);
  const chatRef = useRef<ChatMsg[]>(chat);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

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

  const openConversation = useCallback(
    async (taskId: string) => {
      setSelectedTaskId(taskId);
      setActiveConversationId(taskId);
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
    },
    [],
  );

  // After login / refresh, restore the last open thread.
  useEffect(() => {
    if (!authed) return;
    const id = getPersistedActiveChatId();
    if (!id) return;
    void openConversation(id);
  }, [authed, openConversation]);

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) ?? providers[0] ?? null,
    [providers, activeProviderId],
  );

  useEffect(() => {
    if (!activeProvider) {
      setModelCapabilities({ supported: false, levels: ["off"], preferredLevel: "off", source: "unknown" });
      return;
    }
    const catalog = modelsByProvider[activeProvider.id] ?? [];
    const model = catalog.find((m) => m.id === activeProvider.model);
    if (model?.reasoning) {
      setModelCapabilities(model.reasoning);
    } else {
      setModelCapabilities({ supported: false, levels: ["off"], preferredLevel: "off", source: "unknown" });
    }
  }, [activeProvider, modelsByProvider]);

  // Capability data is needed for the safety drawer as well as the model picker.
  // Fetch it lazily for the active provider so a page reload does not leave the
  // reasoning selector with stale or generic options.
  useEffect(() => {
    if (!authed || !activeProvider?.apiKeyConfigured || modelsByProvider[activeProvider.id]) return;
    void fetchProviderCatalog(activeProvider.id, { trackLoading: false }).catch(() => {
      // The model picker can still explicitly retry a failed catalog request.
    });
  }, [authed, activeProvider, modelsByProvider]);

  useEffect(() => {
    if (modelCapabilities.levels.includes(thinkingLevel)) return;
    const level = modelCapabilities.preferredLevel;
    setThinkingLevel(level);
    void api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ thinkingLevel: level }),
    }).catch(() => {
      // Keep the selector accurate even if the settings request is retried later.
    });
  }, [modelCapabilities, thinkingLevel]);

  useEffect(() => {
    if (!activeProvider) return;
    const selected = (modelsByProvider[activeProvider.id] ?? []).find(
      (model) => model.id === activeProvider.model,
    );
    if (!selected) return;
    const key = `${activeProvider.id}:${selected.id}`;
    if (reasoningModelRef.current === key) return;
    reasoningModelRef.current = key;
    const level = selected.reasoning.preferredLevel;
    setThinkingLevel(level);
    void api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ thinkingLevel: level }),
    }).catch(() => {
      // Selecting a model remains usable if the controller reconnects.
    });
  }, [activeProvider, modelsByProvider]);

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
        api<{ permissionMode: string; thinkingLevel?: ThinkingLevel; preferredThinkingLevel?: ThinkingLevel }>("/v1/settings"),
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
  }, []);

  const refreshOperationalData = useCallback(async () => {
    const [t, a] = await Promise.all([
      api<{ tasks: Task[] }>("/v1/tasks").catch(() => ({ tasks: [] as Task[] })),
      api<{ records: ActivityRecord[] }>("/v1/activity?limit=80"),
    ]);
    setTasks(t.tasks);
    setActivity([...a.records].reverse());
  }, []);

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
                    ? { ...p, state: e.state as any, progress: p.progress ? { completed: p.progress.total, total: p.progress.total } : undefined }
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
  }, [authed, refreshOperationalData]);

  useEffect(() => {
    if (!stickToBottom) {
      setShowJump(true);
      return;
    }
    // Smooth scrolling for each streamed token queues overlapping animations.
    // Follow the latest message at most once per paint instead.
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      scrollFrameRef.current = null;
    });
    setShowJump(false);
    return () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [chat, selectedTask, progressByTask, stickToBottom]);

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
  }, [busy, pickerPanel]);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!pickerRef.current?.contains(ev.target as Node)) setPickerPanel("none");
    }
    if (pickerPanel !== "none") document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pickerPanel]);

  useEffect(() => {
    if (!activeProvider) return;
    setBrowseProviderId(activeProvider.id);
  }, [activeProvider?.id]);

  useEffect(() => {
    if (pickerPanel !== "models") return;
    const id = window.setTimeout(() => modelSearchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [pickerPanel]);

  function updatePiSessionId(id: string | null) {
    setPiSessionIdState(id);
    if (id) {
      setPiSessionId(id);
    } else {
      clearPiSessionId();
    }
  }

  function startNewChat() {
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
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    setToken(tokenInput.trim());
    try {
      await api("/v1/settings");
      setAuthed(true);
      setError(null);
    } catch (err) {
      clearToken();
      setAuthed(false);
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  function presetFor(id: string) {
    return PROVIDER_PRESETS.find((p) => p.id === id);
  }

  function savedProvider(id: string) {
    return providers.find((p) => p.id === id);
  }

  function catalogFor(providerId: string) {
    return (modelsByProvider[providerId] ?? []).map((m) => m.id);
  }

  async function fetchProviderCatalog(providerId: string, opts?: { preferModel?: string; trackLoading?: boolean }) {
    if (opts?.trackLoading !== false) setModelsLoading(true);
    try {
      const res = await api<{ models: DiscoveredModel[] }>(
        `/v1/providers/${encodeURIComponent(providerId)}/models`,
        { method: "POST", body: "{}" },
      );
      const list = res.models ?? [];
      setModelsByProvider((prev) => ({ ...prev, [providerId]: list }));
      return list;
    } catch (e) {
      setModelsByProvider((prev) => ({ ...prev, [providerId]: [] }));
      throw e;
    } finally {
      if (opts?.trackLoading !== false) setModelsLoading(false);
    }
  }

  async function upsertProvider(input: {
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
  }) {
    const body: Record<string, string> = {
      id: input.id,
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
    };
    if (input.apiKey) body.apiKey = input.apiKey;
    const existing = savedProvider(input.id);
    if (
      !body.apiKey &&
      !existing?.apiKeyConfigured &&
      (input.id === "ollama" ||
        input.baseUrl.includes("127.0.0.1") ||
        input.baseUrl.includes("localhost"))
    ) {
      body.apiKey = "local";
    }
    const res = await api<{ provider: Provider }>("/v1/providers", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setActiveProviderId(res.provider.id);
    await refresh();
    return res.provider;
  }

  /** Connect a provider once — pulls the full model catalog. */
  async function connectProvider(providerId: string) {
    const preset = presetFor(providerId);
    const existing = savedProvider(providerId);
    const name = existing?.name ?? preset?.name ?? providerId;
    const baseUrl =
      customBaseUrl.trim() ||
      existing?.baseUrl ||
      preset?.baseUrl ||
      "https://api.openai.com/v1";
    const model = existing?.model || preset?.model || "gpt-4.1-mini";
    const key = connectKey.trim();

    if (!key && !existing?.apiKeyConfigured && providerId !== "ollama") {
      setError("Paste an API key to connect this provider");
      return;
    }
    if (key && (/[^\x20-\x7E]/.test(key) || /grammarly|iterable|not supported/i.test(key))) {
      setError("That paste isn’t an API key (browser extension noise). Copy only the key from opencode.ai/auth.");
      setConnectKey("");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const provider = await upsertProvider({
        id: providerId,
        name,
        baseUrl,
        model,
        apiKey: key || undefined,
      });
      setConnectKey("");
      setShowKeyUpdate(false);
      setBrowseProviderId(provider.id);
      let catalog: DiscoveredModel[] = [];
      try {
        catalog = await fetchProviderCatalog(provider.id, { preferModel: provider.model });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not pull provider models");
      }
      const chosen =
        (catalog.some((entry) => entry.id === provider.model) && provider.model) ||
        catalog[0]?.id ||
        provider.model;
      if (chosen !== provider.model) {
        await upsertProvider({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          model: chosen,
        });
      }
      const selected = catalog.find((entry) => entry.id === chosen);
      const level = selected?.reasoning?.preferredLevel ?? "off";
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ thinkingLevel: level }),
      });
      setThinkingLevel(level);
      await ensurePiSession(provider.id);
      setChat((c) => [
        ...c,
        {
          id: uid(),
          role: "system",
          text: catalog.length
            ? `Connected ${provider.name} — ${catalog.length} models loaded · using ${chosen}`
            : `Connected ${provider.name} · ${chosen}`,
        },
      ]);
      setPickerPanel("models");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect provider failed");
    } finally {
      setBusy(false);
    }
  }

  async function selectModel(providerId: string, model: string) {
    const provider = savedProvider(providerId);
    const preset = presetFor(providerId);
    if (!provider && !preset) return;
    setBusy(true);
    setError(null);
    try {
      const selected = (modelsByProvider[providerId] ?? []).find((entry) => entry.id === model);
      // Persist the selected model's effective level before creating its session.
      // Pi reads this level during session initialization, so doing this after
      // ensurePiSession leaves the new session using the previous model's level.
      const level = selected?.reasoning?.preferredLevel ?? "off";
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ thinkingLevel: level }),
      });
      setThinkingLevel(level);
      const updated = await upsertProvider({
        id: providerId,
        name: provider?.name ?? preset!.name,
        baseUrl: provider?.baseUrl ?? preset!.baseUrl,
        model,
      });
      await ensurePiSession(updated.id);
      setChat((c) => [
        ...c,
        { id: uid(), role: "system", text: `Using ${updated.name} · ${model}` },
      ]);
      setPickerPanel("none");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not select model");
    } finally {
      setBusy(false);
    }
  }

  async function openProvider(providerId: string) {
    setBrowseProviderId(providerId);
    setConnectKey("");
    setCustomBaseUrl("");
    setShowAdvanced(false);
    setShowKeyUpdate(false);
  }

  async function refreshCatalog(providerId = browseProviderId) {
    const existing = savedProvider(providerId);
    if (!existing?.apiKeyConfigured) {
      setError("Connect the provider first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const list = await fetchProviderCatalog(providerId, { preferModel: existing.model });
      if (!list.length) setError("Provider returned no models");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Model discovery failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshAllCatalogs() {
    const connected = providers.filter((p) => p.apiKeyConfigured);
    if (!connected.length) return;
    setModelsLoading(true);
    setError(null);
    try {
      await Promise.all(
        connected.map(async (p) => {
          try {
            await fetchProviderCatalog(p.id, { preferModel: p.model, trackLoading: false });
          } catch {
            // keep other providers
          }
        }),
      );
    } finally {
      setModelsLoading(false);
    }
  }

  async function openModelsPanel() {
    setPickerPanel((cur) => (cur === "models" ? "none" : "models"));
    setModelFilter("");
    const connected = providers.filter((p) => p.apiKeyConfigured);
    const missing = connected.filter((p) => !catalogFor(p.id).length);
    if (missing.length) void refreshAllCatalogs();
  }

  async function testBrowseProvider() {
    const id = browseProviderId;
    if (!savedProvider(id)?.apiKeyConfigured) {
      setError("Connect the provider first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ ok: boolean; model: string; models?: DiscoveredModel[] }>(
        `/v1/providers/${encodeURIComponent(id)}/test`,
        { method: "POST", body: "{}" },
      );
      if (result.models?.length) {
        setModelsByProvider((prev) => ({ ...prev, [id]: result.models! }));
      }
      setChat((c) => [
        ...c,
        { id: uid(), role: "system", text: `Provider test OK — ${result.model}` },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provider test failed");
    } finally {
      setBusy(false);
    }
  }

  async function ensurePiSession(providerId = activeProviderId) {
    if (!providerId) throw new Error("Select a provider first");
    const res = await api<{ session: { id: string } }>("/v1/pi/sessions", {
      method: "POST",
      body: JSON.stringify({ providerId }),
    });
    updatePiSessionId(res.session.id);
    return res.session.id;
  }

  function updateAssistant(
    assistantId: string,
    patch: Partial<ChatMsg> | ((m: ChatMsg) => ChatMsg),
  ) {
    setChat((c) =>
      c.map((m) => {
        if (m.id !== assistantId) return m;
        return typeof patch === "function" ? patch(m) : { ...m, ...patch };
      }),
    );
  }

  // Providers can emit several deltas in a single frame. Applying every one
  // forces a full transcript render and quickly makes the UI fall behind.
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

  function upsertToolPart(parts: MessagePart[] | undefined, part: Extract<MessagePart, { type: "tool_call" }>) {
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

  function stopStreaming() {
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
  }

  async function submitTask(e: FormEvent) {
    e.preventDefault();
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
      // Continuing reuses the same task id — detach it from older turns so the
      // Plan card doesn't jump back above the new user message while replanning.
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
            useMcp: true,
            worldContext,
            history: historyPayload,
          })
        : JSON.stringify({
            piSessionId: session,
            request: text,
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
            let parsed: any = {};
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            if (eventName === "delta" && typeof parsed.text === "string") {
              streamedText += parsed.text;
              queueStreamUpdate(assistantId, (m) => {
                const parts = [...(m.parts ?? [])].filter((p) => p.type !== "status");
                const last = parts.at(-1);
                // A text part is only extended until a tool is emitted. The next
                // delta then becomes a new bubble directly below that tool card.
                if (last?.type === "text") {
                  parts[parts.length - 1] = { type: "text", text: last.text + parsed.text };
                } else {
                  parts.push({ type: "text", text: parsed.text });
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
                // Reasoning belongs at the point it was produced. Do not move a
                // later thought above text or a tool call already in the timeline.
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
              flushStreamUpdates();
              updateAssistant(assistantId, (m) => ({
                ...m,
                parts: [
                  ...(m.parts ?? []).filter((p) => p.type !== "status"),
                  { type: "status", text: parsed.text },
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
        // Keep the streamed ordering. Rebuilding these cards from the plan used
        // to throw away completed tool events and show stale queued tool calls.
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
        // Persist with the completed turn (chatRef may still be mid-stream).
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
      updateAssistant(assistantId, { text: msg, streaming: false, parts: [{ type: "text", text: msg }] });
    } finally {
      if (streamAbortRef.current === abort) streamAbortRef.current = null;
      setBusy(false);
    }
  }

  async function approveTask(task: Task | null = selectedTask) {
    if (!task) return;
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
      setBusy(false);
    }
  }

  async function rejectTask(task: Task | null = selectedTask) {
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
  }

  async function cancelTask(task: Task | null = selectedTask) {
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
  }

  async function editAndReplan(task: Task) {
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
  }
  async function deleteTask(id: string) {
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

  async function patchThinking(level: ThinkingLevel) {
    setBusy(true);
    try {
      const res = await api<{ permissionMode: string; thinkingLevel: ThinkingLevel; preferredThinkingLevel: ThinkingLevel }>("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ thinkingLevel: level }),
      });
      setThinkingLevel(res.preferredThinkingLevel ?? level);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thinking setting failed");
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <div className="login-gate">
        <form className="login-panel stack" onSubmit={login}>
          <h1>IntelaCraft</h1>
          <p>Enter the controller bearer token to open chat.</p>
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
  const modelLabel = activeProvider ? activeProvider.model : "Select model";
  const providerLabel = activeProvider
    ? activeProvider.name
    : providers.some((p) => p.apiKeyConfigured)
      ? "Providers"
      : "Connect provider";
  const providerChoices = [
    ...PROVIDER_PRESETS,
    ...providers
      .filter((p) => !PROVIDER_PRESETS.some((x) => x.id === p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model,
        hint: "Saved custom provider",
      })),
  ];
  const connectedProviders = providers.filter((p) => p.apiKeyConfigured);
  const modelQuery = modelFilter.trim().toLowerCase();
  const filteredModelGroups = connectedProviders
    .map((p) => {
      const catalog = catalogFor(p.id).filter(
        (m) => !modelQuery || m.toLowerCase().includes(modelQuery),
      );
      return { provider: p, catalog };
    })
    .filter((g) => !modelQuery || g.catalog.length > 0);
  const sessionConnected = Boolean(piSessionId) || (health?.agent?.sessions ?? 0) > 0;

  return (
    <div className="chat-app">
      <aside className="sidebar">
        <div className="sidebar-brand">IntelaCraft</div>
        <button type="button" className="sidebar-new" onClick={startNewChat}>
          New chat
        </button>
        <div className="sidebar-threads" aria-label="Tasks">
          {tasks.length === 0 ? (
            <div className="sidebar-empty">No threads yet</div>
          ) : (
            tasks.map((t) => (
              <div
                key={t.id}
                className={t.id === selectedTaskId ? "thread-item active" : "thread-item"}
              >
                <button
                  type="button"
                  className="thread-select"
                  onClick={() => {
                    if (activeConversationId && activeConversationId !== t.id) {
                      saveConversation(activeConversationId, chatRef.current);
                    }
                    void openConversation(t.id);
                  }}
                >
                  <span className="thread-title">{t.request || t.id}</span>
                  <span className="thread-meta">{t.state}</span>
                </button>
                <button
                  type="button"
                  className="thread-delete"
                  title="Delete thread"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTask(t.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        <div className="sidebar-footer">
          <WorldContextPanel health={health} />
          <ConnectionStrip
            bds={Boolean(health?.bdsConnected)}
            model={Boolean(activeProvider)}
            session={sessionConnected}
            mcp={mcp}
            emergency={Boolean(emergencyOn)}
          />
          <div className="sidebar-links">
            <button
              type="button"
              className={drawer === "safety" ? "ghost active" : "ghost"}
              onClick={() => setDrawer(drawer === "safety" ? "none" : "safety")}
            >
              Safety
            </button>
            <button
              type="button"
              className={drawer === "activity" ? "ghost active" : "ghost"}
              onClick={() => setDrawer(drawer === "activity" ? "none" : "activity")}
            >
              Activity
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                clearToken();
                setAuthed(false);
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <div className="workspace-main">
          {error && <div className="banner-error">{error}</div>}
          {authed && health && !health.bdsConnected && (
            <div className="banner-warn">
              Bedrock server offline — start BDS with IntelaCraft packs so the BDS indicator turns green.
            </div>
          )}

          <div
            className="transcript-scroll"
            ref={transcriptRef}
            onScroll={(ev) => {
              const el = ev.currentTarget;
              const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              setStickToBottom(nearBottom);
              setShowJump(!nearBottom);
            }}
          >
            <Transcript
              chat={chat}
              tasks={tasks}
              progressByTask={progressByTask}
              busy={busy}
              chatEndRef={chatEndRef}
              showJump={showJump}
              onJumpLatest={() => {
                setStickToBottom(true);
                chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
                setShowJump(false);
              }}
              onApprove={(task) => void approveTask(task)}
              onReject={(task) => void rejectTask(task)}
              onCancel={(task) => void cancelTask(task)}
              onEditReplan={(task) => void editAndReplan(task)}
            />
          </div>

          <div className="composer-wrap">
            <form className="composer" onSubmit={submitTask}>
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
                data-lt-active="false"
                placeholder={
                  activeProvider
                    ? "Message IntelaCraft…"
                    : "Connect a provider first, then chat…"
                }
              />
              <div className="composer-bar">
                <div className="model-picker" ref={pickerRef}>
                  <button
                    type="button"
                    className="model-trigger"
                    aria-expanded={pickerPanel === "providers"}
                    aria-haspopup="dialog"
                    onClick={() =>
                      setPickerPanel((cur) => (cur === "providers" ? "none" : "providers"))
                    }
                  >
                    <span className="model-trigger-label">{providerLabel}</span>
                    <span className="chev" aria-hidden>
                      ▾
                    </span>
                  </button>
                  <button
                    type="button"
                    className="model-trigger"
                    aria-expanded={pickerPanel === "models"}
                    aria-haspopup="dialog"
                    onClick={() => void openModelsPanel()}
                  >
                    <span className="model-trigger-label">{modelLabel}</span>
                    <span className="chev" aria-hidden>
                      ▾
                    </span>
                  </button>
                  <div className="reasoning-picker">
                    <button
                      type="button"
                      className="model-trigger reasoning-trigger"
                      title="Reasoning effort for the selected model"
                      aria-expanded={pickerPanel === "reasoning"}
                      aria-haspopup="listbox"
                      aria-label="Reasoning effort"
                      disabled={!modelCapabilities.supported || busy}
                      onClick={() =>
                        setPickerPanel((cur) => (cur === "reasoning" ? "none" : "reasoning"))
                      }
                    >
                      <span className="model-trigger-label">
                        {THINKING_LEVEL_LABELS[thinkingLevel] ?? thinkingLevel}
                      </span>
                      <span className="chev" aria-hidden>
                        ▾
                      </span>
                    </button>

                    {pickerPanel === "reasoning" && (
                      <div className="reasoning-menu" role="listbox" aria-label="Reasoning effort">
                        {modelCapabilities.levels.map((level) => (
                          <button
                            key={level}
                            type="button"
                            role="option"
                            aria-selected={thinkingLevel === level}
                            className={
                              thinkingLevel === level ? "reasoning-option active" : "reasoning-option"
                            }
                            disabled={busy}
                            onClick={() => {
                              void patchThinking(level);
                              setPickerPanel("none");
                            }}
                          >
                            {THINKING_LEVEL_LABELS[level] ?? level}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {pickerPanel === "providers" && (
                    <div className="model-popover" role="dialog" aria-label="Connect providers">
                      <div className="popover-fixed">
                        <div className="popover-title">Connect providers</div>
                        <p className="meta">
                          Connect once with an API key. Models show up in the Models menu.
                        </p>
                      </div>
                      <div className="popover-scroll">
                        <ul className="provider-list">
                          {providerChoices.map((p) => {
                            const saved = savedProvider(p.id);
                            const connected = Boolean(saved?.apiKeyConfigured);
                            const selected = p.id === browseProviderId;
                            const modelCount = catalogFor(p.id).length;
                            return (
                              <li key={p.id} className="provider-connect-block">
                                <button
                                  type="button"
                                  className={selected ? "provider-item active" : "provider-item"}
                                  onClick={() => void openProvider(p.id)}
                                  disabled={busy}
                                >
                                  <span className="provider-item-top">
                                    <span className="provider-name">{p.name}</span>
                                    <span className={connected ? "provider-status on" : "provider-status"}>
                                      {connected ? "Connected" : "Setup"}
                                    </span>
                                  </span>
                                  <span className="meta">
                                    {connected
                                      ? `${modelCount || "…"} models available`
                                      : p.hint}
                                  </span>
                                </button>

                                {selected && !connected && (
                                  <div className="provider-connect-form">
                                    <label>
                                      API key
                                      <input
                                        type="password"
                                        autoComplete="off"
                                        spellCheck={false}
                                        data-gramm="false"
                                        data-gramm_editor="false"
                                        data-enable-grammarly="false"
                                        value={connectKey}
                                        placeholder={
                                          p.id.startsWith("opencode")
                                            ? "OpenCode key from opencode.ai/auth"
                                            : p.id === "ollama"
                                              ? "optional for local"
                                              : "sk-…"
                                        }
                                        onChange={(e) => setConnectKey(e.target.value)}
                                      />
                                    </label>
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={() => setShowAdvanced((v) => !v)}
                                    >
                                      {showAdvanced ? "Hide URL" : "Advanced URL"}
                                    </button>
                                    {showAdvanced && (
                                      <label>
                                        Base URL
                                        <input
                                          value={customBaseUrl}
                                          onChange={(e) => setCustomBaseUrl(e.target.value)}
                                          placeholder={p.baseUrl}
                                        />
                                      </label>
                                    )}
                                    <button
                                      type="button"
                                      className="primary"
                                      disabled={busy}
                                      onClick={() => void connectProvider(p.id)}
                                    >
                                      Connect
                                    </button>
                                  </div>
                                )}

                                {selected && connected && (
                                  <div className="provider-connect-form">
                                    <div className="row">
                                      <button
                                        type="button"
                                        className="ghost"
                                        disabled={busy}
                                        onClick={() => void testBrowseProvider()}
                                      >
                                        Test
                                      </button>
                                      <button
                                        type="button"
                                        className="ghost"
                                        disabled={busy || modelsLoading}
                                        onClick={() => void refreshCatalog(p.id)}
                                      >
                                        Refresh models
                                      </button>
                                      <button
                                        type="button"
                                        className="ghost"
                                        disabled={busy}
                                        onClick={() => setShowKeyUpdate((v) => !v)}
                                      >
                                        {showKeyUpdate ? "Cancel" : "Update key"}
                                      </button>
                                    </div>
                                    {showKeyUpdate && (
                                      <div className="row">
                                        <input
                                          type="password"
                                          autoComplete="off"
                                          spellCheck={false}
                                          data-gramm="false"
                                          data-gramm_editor="false"
                                          data-enable-grammarly="false"
                                          value={connectKey}
                                          placeholder="New API key"
                                          onChange={(e) => setConnectKey(e.target.value)}
                                        />
                                        <button
                                          type="button"
                                          className="primary"
                                          disabled={busy || !connectKey.trim()}
                                          onClick={() => void connectProvider(p.id)}
                                        >
                                          Save key
                                        </button>
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      className="ghost"
                                      onClick={() => {
                                        setModelFilter("");
                                        setPickerPanel("models");
                                      }}
                                    >
                                      Open models →
                                    </button>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  )}

                  {pickerPanel === "models" && (
                    <div className="model-popover models-popover" role="dialog" aria-label="Select model">
                      <div className="popover-fixed">
                        <div className="popover-head">
                          <div className="popover-title">Models by provider</div>
                          <button
                            type="button"
                            className="ghost"
                            disabled={busy || modelsLoading || !connectedProviders.length}
                            onClick={() => void refreshAllCatalogs()}
                          >
                            {modelsLoading ? "Loading…" : "Refresh all"}
                          </button>
                        </div>
                        {connectedProviders.length > 0 && (
                          <input
                            ref={modelSearchRef}
                            className="model-search"
                            type="search"
                            value={modelFilter}
                            onChange={(e) => setModelFilter(e.target.value)}
                            placeholder="Filter models…"
                            aria-label="Filter models"
                          />
                        )}
                      </div>
                      <div className="popover-scroll">
                        {!connectedProviders.length ? (
                          <div className="empty-models">
                            <p className="meta">No providers connected yet.</p>
                            <button
                              type="button"
                              className="primary"
                              onClick={() => setPickerPanel("providers")}
                            >
                              Connect a provider
                            </button>
                          </div>
                        ) : filteredModelGroups.length === 0 ? (
                          <div className="models-empty-filter">No models match “{modelFilter.trim()}”</div>
                        ) : (
                          filteredModelGroups.map(({ provider: p, catalog }) => {
                            const fullCount = catalogFor(p.id).length;
                            return (
                              <div key={p.id} className="model-group">
                                <div className="model-group-head">
                                  <span className="model-group-title">{p.name}</span>
                                  <span className="meta">
                                    {modelsLoading && !fullCount
                                      ? "loading…"
                                      : modelQuery
                                        ? `${catalog.length} / ${fullCount}`
                                        : `${catalog.length} models`}
                                  </span>
                                </div>
                                {catalog.length === 0 ? (
                                  <p className="meta">No models yet — refresh this provider.</p>
                                ) : (
                                  <ul className="model-list">
                                    {catalog.map((m) => {
                                      const active =
                                        activeProvider?.id === p.id && activeProvider.model === m;
                                      return (
                                        <li key={m}>
                                          <button
                                            type="button"
                                            className={active ? "model-item active" : "model-item"}
                                            disabled={busy}
                                            onClick={() => void selectModel(p.id, m)}
                                          >
                                            <span className="model-item-id">{m}</span>
                                            <span className="model-item-check" aria-hidden>
                                              ✓
                                            </span>
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {busy ? (
                  <button className="danger send" type="button" onClick={stopStreaming}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="primary send"
                    type="submit"
                    disabled={!prompt.trim() || !health?.bdsConnected}
                  >
                    Send
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {drawer !== "none" && (
          <aside className="chat-drawer">
            {drawer === "safety" && (
              <div className="stack">
                <h2>Safety</h2>
                <label>
                  Permission mode
                  <select value={permissionMode} onChange={(e) => void patchMode(e.target.value)}>
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Thinking level
                  <select
                    value={thinkingLevel}
                    onChange={(e) => void patchThinking(e.target.value as ThinkingLevel)}
                  >
                    {(modelCapabilities.levels.length > 0 ? modelCapabilities.levels : THINKING_LEVELS).map((m) => (
                      <option key={m} value={m}>
                        {THINKING_LEVEL_LABELS[m] ?? m}
                      </option>
                    ))}
                  </select>
                  {modelCapabilities.source !== "unknown" && (
                    <span className="hint">
                      {modelCapabilities.supported ? "Reasoning supported" : "No reasoning support"}
                      {modelCapabilities.source === "override" ? " (known model)" : ""}
                    </span>
                  )}
                </label>
                <div className="row">
                  <button className="danger" type="button" disabled={busy} onClick={() => void emergency(true)}>
                    Emergency disable
                  </button>
                  <button type="button" disabled={busy || !emergencyOn} onClick={() => void emergency(false)}>
                    Clear
                  </button>
                </div>
              </div>
            )}
            {drawer === "activity" && (
              <div className="stack">
                <h2>Activity</h2>
                <input
                  placeholder="Filter…"
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                  aria-label="Filter activity"
                />
                <div className="activity-list">
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
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

export { ConnDot } from "./components/ConnectionStrip";

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
