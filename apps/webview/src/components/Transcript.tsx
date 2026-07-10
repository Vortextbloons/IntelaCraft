import type { RefObject } from "react";
import type { ChatMsg, Task, ToolRun } from "../types";
import { taskNeedsPlanCard } from "../types";
import { MarkdownText } from "./MarkdownText";
import { PlanCard } from "./PlanCard";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallCard } from "./ToolCallCard";

export function Transcript({
  chat,
  tasks,
  progressByTask,
  busy,
  chatEndRef,
  showJump,
  onJumpLatest,
  onApprove,
  onReject,
  onCancel,
  onEditReplan,
}: {
  chat: ChatMsg[];
  tasks: Task[];
  progressByTask: Record<string, ToolRun>;
  busy: boolean;
  chatEndRef: RefObject<HTMLDivElement | null>;
  showJump: boolean;
  onJumpLatest: () => void;
  onApprove: (task: Task) => void;
  onReject: (task: Task) => void;
  onCancel: (task: Task) => void;
  onEditReplan: (task: Task) => void;
}) {
  return (
    <div className="transcript" aria-live="polite">
      <div className="transcript-inner">
        {chat.map((m) => {
          const task = m.taskId ? tasks.find((t) => t.id === m.taskId) : undefined;
          const liveProgress = m.taskId ? progressByTask[m.taskId] : undefined;
          const toolRuns = m.toolRuns?.length
            ? m.toolRuns
            : liveProgress
              ? [liveProgress]
              : [];
          const showPlan = task && taskNeedsPlanCard(task);
          const parts = m.parts ?? [];
          const reasoning = parts.find((p) => p.type === "reasoning");
          const toolParts = parts.filter((p) => p.type === "tool_call");
          const statusParts = parts.filter((p) => p.type === "status");
          const textParts = parts.filter((p) => p.type === "text");
          const bodyText =
            textParts.map((p) => (p.type === "text" ? p.text : "")).join("") || m.text;

          return (
            <div key={m.id} className={`turn ${m.role}${m.streaming ? " streaming" : ""}`}>
              <div className="turn-stack">
                <div className="turn-role">
                  {m.role === "user" ? "You" : m.role === "assistant" ? "IntelaCraft" : "System"}
                </div>

                {m.role === "assistant" && reasoning && reasoning.type === "reasoning" && (
                  <ReasoningBlock text={reasoning.text} streaming={reasoning.streaming} />
                )}

                {statusParts.map((p, i) =>
                  p.type === "status" ? (
                    <div key={`st-${i}`} className="turn-status meta">
                      {p.text}
                    </div>
                  ) : null,
                )}

                {(bodyText || m.streaming) && (
                  <div className="turn-bubble">
                    {m.role === "assistant" ? (
                      <MarkdownText className="turn-body" text={bodyText || (m.streaming ? "▍" : "")} />
                    ) : (
                      <div className="turn-body">{bodyText}</div>
                    )}
                    {m.streaming && <span className="stream-caret" aria-hidden />}
                  </div>
                )}

                {toolParts.map((p) =>
                  p.type === "tool_call" ? <ToolCallCard key={p.id} part={p} /> : null,
                )}

                {showPlan && task && (
                  <PlanCard
                    task={task}
                    busy={busy}
                    onApprove={() => onApprove(task)}
                    onReject={() => onReject(task)}
                    onCancel={() => onCancel(task)}
                    onEditReplan={() => onEditReplan(task)}
                  />
                )}

                {toolRuns.map((run) => (
                  <ToolCallCard key={run.actionId} run={run} />
                ))}
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>
      {showJump && (
        <button type="button" className="jump-latest" onClick={onJumpLatest}>
          Jump to latest
        </button>
      )}
    </div>
  );
}
