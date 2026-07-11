import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, clearPiSessionId, getPiSessionId, setPiSessionId } from "../api";
import { PROVIDER_PRESETS } from "../constants";
import { uid } from "../lib/chat-helpers";
import type { ChatMsg, DiscoveredModel, Provider } from "../types";

export function useProviders(deps: {
  authed: boolean;
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
  setChat: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  setThinkingLevel: (level: import("../types").ThinkingLevel) => void;
  providers: Provider[];
  setProviders: React.Dispatch<React.SetStateAction<Provider[]>>;
  activeProviderId: string;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
}) {
  const {
    authed,
    setError,
    setBusy,
    refresh,
    setChat,
    setThinkingLevel,
    providers,
    setProviders,
    activeProviderId,
    setActiveProviderId,
  } = deps;

  const [piSessionId, setPiSessionIdState] = useState<string | null>(getPiSessionId);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, DiscoveredModel[]>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [browseProviderId, setBrowseProviderId] = useState("opencode-zen");
  const [connectKey, setConnectKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showKeyUpdate, setShowKeyUpdate] = useState(false);
  const [pickerPanel, setPickerPanel] = useState<"none" | "providers" | "models" | "reasoning">("none");
  const [modelFilter, setModelFilter] = useState("");
  const [currentModelProviderId, setCurrentModelProviderId] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const modelsScrollRef = useRef<HTMLDivElement>(null);
  const modelGroupRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) ?? providers[0] ?? null,
    [providers, activeProviderId],
  );

  function updatePiSessionId(id: string | null) {
    setPiSessionIdState(id);
    if (id) {
      setPiSessionId(id);
    } else {
      clearPiSessionId();
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

  const fetchProviderCatalog = useCallback(
    async (providerId: string, opts?: { preferModel?: string; trackLoading?: boolean }) => {
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
    },
    [],
  );

  const upsertProvider = useCallback(
    async (input: {
      id: string;
      name: string;
      baseUrl: string;
      model: string;
      apiKey?: string;
    }) => {
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
    },
    [refresh, setActiveProviderId],
  );

  const ensurePiSession = useCallback(
    async (providerId = activeProviderId) => {
      if (!providerId) throw new Error("Select a provider first");
      const res = await api<{ session: { id: string } }>("/v1/pi/sessions", {
        method: "POST",
        body: JSON.stringify({ providerId }),
      });
      updatePiSessionId(res.session.id);
      return res.session.id;
    },
    [activeProviderId],
  );

  // Capability data is needed for the safety drawer as well as the model picker.
  // Fetch it lazily for the active provider so a page reload does not leave the
  // reasoning selector with stale or generic options.
  useEffect(() => {
    if (!authed || !activeProvider?.apiKeyConfigured || modelsByProvider[activeProvider.id]) return;
    void fetchProviderCatalog(activeProvider.id, { trackLoading: false }).catch(() => {
      // The model picker can still explicitly retry a failed catalog request.
    });
  }, [authed, activeProvider, modelsByProvider, fetchProviderCatalog]);

  useEffect(() => {
    if (!activeProvider) return;
    setBrowseProviderId(activeProvider.id);
  }, [activeProvider?.id]);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!pickerRef.current?.contains(ev.target as Node)) setPickerPanel("none");
    }
    if (pickerPanel !== "none") document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pickerPanel]);

  useEffect(() => {
    if (pickerPanel !== "models") return;
    const id = window.setTimeout(() => modelSearchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [pickerPanel]);

  const connectProvider = useCallback(
    async (providerId: string) => {
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
        setError("That paste isn't an API key (browser extension noise). Copy only the key from opencode.ai/auth.");
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
    },
    [
      connectKey,
      customBaseUrl,
      ensurePiSession,
      fetchProviderCatalog,
      setBusy,
      setChat,
      setError,
      setThinkingLevel,
      upsertProvider,
    ],
  );

  const selectModel = useCallback(
    async (providerId: string, model: string) => {
      const provider = savedProvider(providerId);
      const preset = presetFor(providerId);
      if (!provider && !preset) return;
      setBusy(true);
      setError(null);
      try {
        const selected = (modelsByProvider[providerId] ?? []).find((entry) => entry.id === model);
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
    },
    [ensurePiSession, modelsByProvider, setBusy, setChat, setError, setThinkingLevel, upsertProvider],
  );

  const openProvider = useCallback(async (providerId: string) => {
    setBrowseProviderId(providerId);
    setConnectKey("");
    setCustomBaseUrl("");
    setShowAdvanced(false);
    setShowKeyUpdate(false);
  }, []);

  const refreshCatalog = useCallback(
    async (providerId = browseProviderId) => {
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
    },
    [browseProviderId, fetchProviderCatalog, setBusy, setError],
  );

  const refreshAllCatalogs = useCallback(async () => {
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
  }, [fetchProviderCatalog, providers, setError]);

  const openModelsPanel = useCallback(async () => {
    setPickerPanel((cur) => (cur === "models" ? "none" : "models"));
    setModelFilter("");
    const connected = providers.filter((p) => p.apiKeyConfigured);
    const missing = connected.filter((p) => !catalogFor(p.id).length);
    if (missing.length) void refreshAllCatalogs();
  }, [providers, refreshAllCatalogs]);

  const testBrowseProvider = useCallback(async () => {
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
  }, [browseProviderId, setBusy, setChat, setError]);

  const providerChoices = useMemo(
    () => [
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
    ],
    [providers],
  );

  const connectedProviders = useMemo(
    () => providers.filter((p) => p.apiKeyConfigured),
    [providers],
  );

  const modelQuery = modelFilter.trim().toLowerCase();
  const filteredModelGroups = useMemo(
    () =>
      connectedProviders
        .map((p) => {
          const catalog = catalogFor(p.id).filter(
            (m) => !modelQuery || m.toLowerCase().includes(modelQuery),
          );
          return { provider: p, catalog };
        })
        .filter((g) => !modelQuery || g.catalog.length > 0),
    [connectedProviders, modelQuery, modelsByProvider],
  );

  const modelLabel = activeProvider ? activeProvider.model : "Select model";
  const providerLabel = activeProvider
    ? activeProvider.name
    : providers.some((p) => p.apiKeyConfigured)
      ? "Providers"
      : "Connect provider";

  return {
    piSessionId,
    updatePiSessionId,
    modelsByProvider,
    modelsLoading,
    browseProviderId,
    connectKey,
    setConnectKey,
    customBaseUrl,
    setCustomBaseUrl,
    showAdvanced,
    setShowAdvanced,
    showKeyUpdate,
    setShowKeyUpdate,
    pickerPanel,
    setPickerPanel,
    modelFilter,
    setModelFilter,
    currentModelProviderId,
    setCurrentModelProviderId,
    pickerRef,
    modelSearchRef,
    modelsScrollRef,
    modelGroupRefs,
    activeProvider,
    connectProvider,
    selectModel,
    openProvider,
    refreshCatalog,
    refreshAllCatalogs,
    openModelsPanel,
    testBrowseProvider,
    ensurePiSession,
    catalogFor,
    savedProvider,
    providerChoices,
    connectedProviders,
    filteredModelGroups,
    modelQuery,
    modelLabel,
    providerLabel,
  };
}
