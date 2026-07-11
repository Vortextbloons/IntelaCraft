import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { NO_REASONING_CAPABILITIES } from "../constants";
import type { Provider, ReasoningCapabilities, ThinkingLevel } from "../types";

export function useSettings(deps: {
  authed: boolean;
  activeProvider: Provider | null;
  modelsByProvider: Record<string, import("../types").DiscoveredModel[]>;
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const { authed, activeProvider, modelsByProvider, setError, setBusy, refresh } = deps;

  const [permissionMode, setPermissionMode] = useState("confirm_every_change");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("minimal");
  const [modelCapabilities, setModelCapabilities] = useState<ReasoningCapabilities>({
    supported: false,
    levels: ["off"],
    preferredLevel: "off",
    source: "unknown",
  });
  const reasoningModelRef = useRef<string | null>(null);

  useEffect(() => {
    const next = (() => {
      if (!activeProvider) return NO_REASONING_CAPABILITIES;
      const catalog = modelsByProvider[activeProvider.id] ?? [];
      const model = catalog.find((m) => m.id === activeProvider.model);
      return model?.reasoning ?? NO_REASONING_CAPABILITIES;
    })();

    // Avoid replacing state with an equivalent object: provider refreshes can
    // otherwise retrigger dependent effects indefinitely in development mode.
    setModelCapabilities((current) =>
      current.supported === next.supported &&
      current.preferredLevel === next.preferredLevel &&
      current.source === next.source &&
      current.levels.length === next.levels.length &&
      current.levels.every((level, index) => level === next.levels[index])
        ? current
        : next,
    );
  }, [activeProvider, modelsByProvider]);

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

  const emergency = useCallback(
    async (disabled: boolean) => {
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
    },
    [refresh, setBusy, setError],
  );

  const patchMode = useCallback(
    async (mode: string) => {
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
    },
    [setBusy, setError],
  );

  const patchThinking = useCallback(
    async (level: ThinkingLevel) => {
      setBusy(true);
      try {
        const res = await api<{
          permissionMode: string;
          thinkingLevel: ThinkingLevel;
          preferredThinkingLevel: ThinkingLevel;
        }>("/v1/settings", {
          method: "PATCH",
          body: JSON.stringify({ thinkingLevel: level }),
        });
        setThinkingLevel(res.preferredThinkingLevel ?? level);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Thinking setting failed");
      } finally {
        setBusy(false);
      }
    },
    [setBusy, setError],
  );

  return {
    permissionMode,
    setPermissionMode,
    thinkingLevel,
    setThinkingLevel,
    modelCapabilities,
    emergency,
    patchMode,
    patchThinking,
  };
}
