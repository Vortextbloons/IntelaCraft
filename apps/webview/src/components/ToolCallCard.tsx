import type { ReactNode } from "react";
import type { MessagePart, ToolRun } from "../types";
import {
  extractToolResultFacts,
  formatCoord,
  formatInspectResult,
  parseToolResultText,
  shortDimension,
  type ToolResultFacts,
} from "../utils/format";
import { HighlightedJson } from "./HighlightedJson";

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
  const rawError = part?.error ?? run?.error;
  const errorText = rawError ?? (state === "failed" ? "Failed" : undefined);
  const resultText =
    part?.resultText ??
    (run && done
      ? run.error
        ? `Failed: ${run.error}`
        : formatInspectResult(run.message || state, run.result)
      : undefined);
  const argsSummary = part?.argsSummary;
  const showResult = Boolean(errorText || (resultText && done));

  const parsed = !errorText && resultText ? parseDisplayResult(resultText, run?.result) : null;
  const facts = parsed?.data ? extractToolResultFacts(parsed.data) : null;

  return (
    <div className={`tool-card compact phase-${phase ?? "plan"} state-${state}`}>
      <div className="tool-card-head">
        <span className={`tool-dot ${done ? (errorText ? "bad" : "ok") : "run"}`} aria-hidden />
        <strong className="tool-name">{name}</strong>
        <span className="meta tool-state">{errorText ? "failed" : state}</span>
        {total > 0 && (
          <span className="meta">
            {completed}/{total}
          </span>
        )}
      </div>
      {argsSummary && !argsSummary.startsWith("call_") && (
        <div className="tool-args meta">{argsSummary}</div>
      )}
      {!done && total > 0 && (
        <div className="progress-bar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {showResult &&
        (errorText ? (
          <pre className="tool-result tool-result-error">Failed: {errorText}</pre>
        ) : parsed ? (
          <ToolResultBody summary={parsed.summary} data={parsed.data} facts={facts} />
        ) : (
          <pre className="tool-result">{resultText}</pre>
        ))}
    </div>
  );
}

function parseDisplayResult(
  resultText: string,
  structured?: unknown,
): { summary: string; data?: unknown } {
  const fromText = parseToolResultText(resultText);
  if (fromText.data !== undefined) return fromText;

  if (structured !== undefined && structured !== null && typeof structured === "object") {
    if (extractToolResultFacts(structured)) {
      return {
        summary: fromText.summary || resultText.trim(),
        data: structured,
      };
    }
  }
  return fromText;
}

function ToolResultBody({
  summary,
  data,
  facts,
}: {
  summary: string;
  data?: unknown;
  facts: ToolResultFacts | null;
}) {
  const hasJson = data !== undefined;
  const plainOnly = !hasJson && summary;

  if (plainOnly) {
    return <div className="tool-result-summary">{summary}</div>;
  }

  return (
    <div className="tool-result-body">
      {summary && <div className="tool-result-summary">{formatSummary(summary)}</div>}
      {facts && <ResultFacts facts={facts} />}
      {hasJson && (
        <details className="tool-json" open={!facts}>
          <summary>Raw JSON</summary>
          <HighlightedJson value={data} />
        </details>
      )}
    </div>
  );
}

function formatSummary(summary: string): ReactNode {
  const parts = summary.split(/(\d[\d,]*)/g);
  if (parts.length === 1) return summary;
  return parts.map((part, i) =>
    /^\d[\d,]*$/.test(part) ? (
      <span key={i} className="tool-result-accent">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function ResultFacts({ facts }: { facts: ToolResultFacts }) {
  return (
    <div className="tool-facts">
      {facts.dimension && (
        <div className="tool-fact">
          <span className="tool-fact-label">Dimension</span>
          <code>{shortDimension(facts.dimension)}</code>
        </div>
      )}
      {facts.blockType && (
        <div className="tool-fact">
          <span className="tool-fact-label">Block</span>
          <code>{shortDimension(facts.blockType)}</code>
        </div>
      )}
      {facts.region && (
        <>
          <div className="tool-fact">
            <span className="tool-fact-label">Min</span>
            <code className="tool-fact-coords">{formatCoord(facts.region.min)}</code>
          </div>
          <div className="tool-fact">
            <span className="tool-fact-label">Max</span>
            <code className="tool-fact-coords">{formatCoord(facts.region.max)}</code>
          </div>
          {facts.layers != null && (
            <div className="tool-fact">
              <span className="tool-fact-label">Layers</span>
              <code>
                {facts.layers}{" "}
                <span className="meta">
                  (Y {facts.region.min.y}–{facts.region.max.y})
                </span>
              </code>
            </div>
          )}
        </>
      )}
      {facts.position && !facts.region && (
        <div className="tool-fact">
          <span className="tool-fact-label">Position</span>
          <code className="tool-fact-coords">{formatCoord(facts.position)}</code>
        </div>
      )}
      {facts.count != null && (
        <div className="tool-fact">
          <span className="tool-fact-label">Count</span>
          <code className="tool-fact-coords">{facts.count.toLocaleString()}</code>
        </div>
      )}
    </div>
  );
}
