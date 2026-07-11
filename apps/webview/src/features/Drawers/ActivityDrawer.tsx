import type { ActivityRecord } from "../../types";

type ActivityDrawerProps = {
  activityFilter: string;
  setActivityFilter: (filter: string) => void;
  filteredActivity: ActivityRecord[];
};

export function ActivityDrawer({
  activityFilter,
  setActivityFilter,
  filteredActivity,
}: ActivityDrawerProps) {
  return (
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
  );
}
