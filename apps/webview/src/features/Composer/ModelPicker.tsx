import type { Provider } from "../../types";

type ModelPickerProps = {
  connectedProviders: Provider[];
  filteredModelGroups: Array<{ provider: Provider; catalog: string[] }>;
  activeProvider: Provider | null;
  modelFilter: string;
  setModelFilter: (filter: string) => void;
  modelQuery: string;
  modelsLoading: boolean;
  busy: boolean;
  modelSearchRef: React.RefObject<HTMLInputElement | null>;
  catalogFor: (providerId: string) => string[];
  onRefreshAllCatalogs: () => void;
  onSelectModel: (providerId: string, model: string) => void;
  onOpenProviders: () => void;
};

export function ModelPicker({
  connectedProviders,
  filteredModelGroups,
  activeProvider,
  modelFilter,
  setModelFilter,
  modelQuery,
  modelsLoading,
  busy,
  modelSearchRef,
  catalogFor,
  onRefreshAllCatalogs,
  onSelectModel,
  onOpenProviders,
}: ModelPickerProps) {
  return (
    <div className="model-popover models-popover" role="dialog" aria-label="Select model">
      <div className="popover-fixed">
        <div className="popover-head">
          <div className="popover-title">Models by provider</div>
          <button
            type="button"
            className="ghost"
            disabled={busy || modelsLoading || !connectedProviders.length}
            onClick={() => void onRefreshAllCatalogs()}
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
            <button type="button" className="primary" onClick={onOpenProviders}>
              Connect a provider
            </button>
          </div>
        ) : filteredModelGroups.length === 0 ? (
          <div className="models-empty-filter">No models match "{modelFilter.trim()}"</div>
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
                      const active = activeProvider?.id === p.id && activeProvider.model === m;
                      return (
                        <li key={m}>
                          <button
                            type="button"
                            className={active ? "model-item active" : "model-item"}
                            disabled={busy}
                            onClick={() => void onSelectModel(p.id, m)}
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
  );
}
