import type { Provider } from "../../types";

type ProviderChoice = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hint: string;
};

type ProviderPickerProps = {
  providerChoices: ProviderChoice[];
  browseProviderId: string;
  connectKey: string;
  setConnectKey: (key: string) => void;
  customBaseUrl: string;
  setCustomBaseUrl: (url: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (show: boolean) => void;
  showKeyUpdate: boolean;
  setShowKeyUpdate: (show: boolean) => void;
  busy: boolean;
  modelsLoading: boolean;
  savedProvider: (id: string) => Provider | undefined;
  catalogFor: (providerId: string) => string[];
  onOpenProvider: (providerId: string) => void;
  onConnectProvider: (providerId: string) => void;
  onTestBrowseProvider: () => void;
  onRefreshCatalog: (providerId: string) => void;
  onOpenModels: () => void;
};

export function ProviderPicker({
  providerChoices,
  browseProviderId,
  connectKey,
  setConnectKey,
  customBaseUrl,
  setCustomBaseUrl,
  showAdvanced,
  setShowAdvanced,
  showKeyUpdate,
  setShowKeyUpdate,
  busy,
  modelsLoading,
  savedProvider,
  catalogFor,
  onOpenProvider,
  onConnectProvider,
  onTestBrowseProvider,
  onRefreshCatalog,
  onOpenModels,
}: ProviderPickerProps) {
  return (
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
                  onClick={() => void onOpenProvider(p.id)}
                  disabled={busy}
                >
                  <span className="provider-item-top">
                    <span className="provider-name">{p.name}</span>
                    <span className={connected ? "provider-status on" : "provider-status"}>
                      {connected ? "Connected" : "Setup"}
                    </span>
                  </span>
                  <span className="meta">
                    {connected ? `${modelCount || "…"} models available` : p.hint}
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
                      onClick={() => setShowAdvanced(!showAdvanced)}
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
                      onClick={() => void onConnectProvider(p.id)}
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
                        onClick={() => void onTestBrowseProvider()}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || modelsLoading}
                        onClick={() => void onRefreshCatalog(p.id)}
                      >
                        Refresh models
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => setShowKeyUpdate(!showKeyUpdate)}
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
                          onClick={() => void onConnectProvider(p.id)}
                        >
                          Save key
                        </button>
                      </div>
                    )}
                    <button type="button" className="ghost" onClick={onOpenModels}>
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
  );
}
