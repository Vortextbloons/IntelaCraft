import type { Health } from "../types";

export function WorldContextPanel({ health }: { health: Health | null }) {
  const session = health?.sessions?.[0];
  const h = session?.health;
  if (!health?.bdsConnected) {
    return (
      <div className="world-context">
        <div className="world-context-title">World</div>
        <div className="meta">BDS offline — no live context</div>
      </div>
    );
  }
  return (
    <div className="world-context">
      <div className="world-context-title">World</div>
      <div className="world-facts">
        <span>
          Server <code>{session?.serverId ?? "—"}</code>
        </span>
        <span>
          Players <code>{h?.playerCount ?? "—"}</code>
        </span>
        {h?.tick != null && (
          <span>
            Tick <code>{h.tick}</code>
          </span>
        )}
        {h?.ok != null && (
          <span>
            Health <code>{h.ok ? "ok" : "degraded"}</code>
          </span>
        )}
      </div>
    </div>
  );
}
