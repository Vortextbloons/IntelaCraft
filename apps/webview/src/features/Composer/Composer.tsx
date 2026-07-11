import type { FormEvent, RefObject } from "react";
import { saveAiMode } from "../../lib/chat-helpers";
import { THINKING_LEVEL_LABELS, type Provider, type ReasoningCapabilities, type ThinkingLevel } from "../../types";
import { ModelPicker } from "./ModelPicker";
import { ProviderPicker } from "./ProviderPicker";
import { ReasoningPicker } from "./ReasoningPicker";

type ProviderChoice = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hint: string;
};

type ComposerProps = {
  prompt: string;
  setPrompt: (prompt: string) => void;
  busy: boolean;
  bdsConnected: boolean;
  activeProvider: Provider | null;
  providerLabel: string;
  modelLabel: string;
  aiMode: "ask" | "agent";
  setAiMode: (mode: "ask" | "agent") => void;
  pickerPanel: "none" | "providers" | "models" | "reasoning";
  setPickerPanel: (panel: "none" | "providers" | "models" | "reasoning") => void;
  pickerRef: RefObject<HTMLDivElement | null>;
  thinkingLevel: ThinkingLevel;
  modelCapabilities: ReasoningCapabilities;
  onSubmit: (e: FormEvent) => void;
  onStop: () => void;
  onOpenModelsPanel: () => void;
  onPatchThinking: (level: ThinkingLevel) => void;
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
  modelsLoading: boolean;
  savedProvider: (id: string) => Provider | undefined;
  catalogFor: (providerId: string) => string[];
  onOpenProvider: (providerId: string) => void;
  onConnectProvider: (providerId: string) => void;
  onTestBrowseProvider: () => void;
  onRefreshCatalog: (providerId: string) => void;
  connectedProviders: Provider[];
  filteredModelGroups: Array<{ provider: Provider; catalog: string[] }>;
  modelFilter: string;
  setModelFilter: (filter: string) => void;
  modelQuery: string;
  modelSearchRef: RefObject<HTMLInputElement | null>;
  onRefreshAllCatalogs: () => void;
  onSelectModel: (providerId: string, model: string) => void;
};

export function Composer({
  prompt,
  setPrompt,
  busy,
  bdsConnected,
  activeProvider,
  providerLabel,
  modelLabel,
  aiMode,
  setAiMode,
  pickerPanel,
  setPickerPanel,
  pickerRef,
  thinkingLevel,
  modelCapabilities,
  onSubmit,
  onStop,
  onOpenModelsPanel,
  onPatchThinking,
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
  modelsLoading,
  savedProvider,
  catalogFor,
  onOpenProvider,
  onConnectProvider,
  onTestBrowseProvider,
  onRefreshCatalog,
  connectedProviders,
  filteredModelGroups,
  modelFilter,
  setModelFilter,
  modelQuery,
  modelSearchRef,
  onRefreshAllCatalogs,
  onSelectModel,
}: ComposerProps) {
  return (
    <div className="composer-wrap">
      <form className="composer" onSubmit={onSubmit}>
        <textarea
          rows={2}
          value={prompt}
          disabled={busy}
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
            activeProvider ? "Message IntelaCraft…" : "Connect a provider first, then chat…"
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
                setPickerPanel(pickerPanel === "providers" ? "none" : "providers")
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
              onClick={() => void onOpenModelsPanel()}
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
                  setPickerPanel(pickerPanel === "reasoning" ? "none" : "reasoning")
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
                <ReasoningPicker
                  thinkingLevel={thinkingLevel}
                  modelCapabilities={modelCapabilities}
                  busy={busy}
                  onPatchThinking={onPatchThinking}
                  onClose={() => setPickerPanel("none")}
                />
              )}
            </div>

            {pickerPanel === "providers" && (
              <ProviderPicker
                providerChoices={providerChoices}
                browseProviderId={browseProviderId}
                connectKey={connectKey}
                setConnectKey={setConnectKey}
                customBaseUrl={customBaseUrl}
                setCustomBaseUrl={setCustomBaseUrl}
                showAdvanced={showAdvanced}
                setShowAdvanced={setShowAdvanced}
                showKeyUpdate={showKeyUpdate}
                setShowKeyUpdate={setShowKeyUpdate}
                busy={busy}
                modelsLoading={modelsLoading}
                savedProvider={savedProvider}
                catalogFor={catalogFor}
                onOpenProvider={onOpenProvider}
                onConnectProvider={onConnectProvider}
                onTestBrowseProvider={onTestBrowseProvider}
                onRefreshCatalog={onRefreshCatalog}
                onOpenModels={() => {
                  setModelFilter("");
                  setPickerPanel("models");
                }}
              />
            )}

            {pickerPanel === "models" && (
              <ModelPicker
                connectedProviders={connectedProviders}
                filteredModelGroups={filteredModelGroups}
                activeProvider={activeProvider}
                modelFilter={modelFilter}
                setModelFilter={setModelFilter}
                modelQuery={modelQuery}
                modelsLoading={modelsLoading}
                busy={busy}
                modelSearchRef={modelSearchRef}
                catalogFor={catalogFor}
                onRefreshAllCatalogs={onRefreshAllCatalogs}
                onSelectModel={onSelectModel}
                onOpenProviders={() => setPickerPanel("providers")}
              />
            )}
          </div>
          <div className="composer-actions">
            <div className="ai-mode" role="group" aria-label="Interaction mode">
              <button
                type="button"
                className={aiMode === "ask" ? "active" : ""}
                onClick={() => {
                  setAiMode("ask");
                  saveAiMode("ask");
                }}
                disabled={busy}
              >
                Ask
              </button>
              <button
                type="button"
                className={aiMode === "agent" ? "active" : ""}
                onClick={() => {
                  setAiMode("agent");
                  saveAiMode("agent");
                }}
                disabled={busy}
              >
                Agent
              </button>
            </div>
            {busy ? (
              <button className="danger send" type="button" onClick={onStop}>
                Stop
              </button>
            ) : (
              <button className="primary send" type="submit" disabled={!prompt.trim() || !bdsConnected}>
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
