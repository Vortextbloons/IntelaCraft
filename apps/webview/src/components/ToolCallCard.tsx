import type { MessagePart, ToolRun } from "../types";
import { formatInspectResult } from "../utils/format";

type ToolPart = Extract<MessagePart, { type: "tool_call" }>;

export function ToolCallCard({
  part,
  run,
}: {
  part?: ToolPart;
  run?: ToolRun;
}) {
  const name = part?.name ?? run?.toolName ?? "tool";
  const state = part?.state ?? run?.state ?? "pending";
  const phase = part?.phase ?? run?.phase;
  const completed = part?.progress?.completed ?? run?.completedWork ?? 0;
  const total = part?.progress?.total ?? run?.totalEstimatedWork ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const done =
    state === "completed" ||
    state === "failed" ||
    state === "partially_completed" ||
    state === "end";
  const error = part?.error ?? run?.error;
  const resultText =
    part?.resultText ??
    (run && done
      ? run.error
        ? `Failed: ${run.error}`
        : formatInspectResult(run.message || state, run.result)
      : run?.message);
  const argsSummary = part?.argsSummary;

  return (
    <div className={`tool-card phase-${phase ?? "plan"} state-${state}`}>
      <div className="tool-card-head">
        <span className="tool-phase">{phase ?? "tool"}</span>
        <strong className="tool-name">{name}</strong>
        <span className="meta">{state}</span>
        {total > 0 && (
          <span className="meta">
            {completed}/{total}
          </span>
        )}
      </div>
      {argsSummary && <div className="tool-args meta">{argsSummary}</div>}
      {!done && total > 0 && (
        <div className="progress-bar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {(resultText || error) && (
        <pre className="tool-result">{error ? `Failed: ${error}` : resultText}</pre>
      )}
    </div>
  );
}
