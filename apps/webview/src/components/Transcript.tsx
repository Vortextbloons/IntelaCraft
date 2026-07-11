import { useMemo, type RefObject } from "react";
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
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const latestMessageByTask = useMemo(() => {
    const latest = new Map<string, number>();
    for (let i = 0; i < chat.length; i++) {
      const taskId = chat[i].taskId;
      if (taskId) latest.set(taskId, i);
    }
    return latest;
  }, [chat]);

  return (
    <div className="transcript" aria-live="polite">
      <div className="transcript-inner">
        {chat.map((m, index) => {
          const task = m.taskId ? tasksById.get(m.taskId) : undefined;
          const liveProgress = m.taskId ? progressByTask[m.taskId] : undefined;
          const toolRuns = m.toolRuns?.length
            ? m.toolRuns
            : liveProgress
              ? [liveProgress]
              : [];
          const parts = m.parts ?? [];
          // Render parts in their emitted order. This keeps an assistant response
          // flowing below each tool call instead of collecting every tool at the end.
          const displayParts =
            parts.length > 0 ? parts : m.text ? [{ type: "text" as const, text: m.text }] : [];
          // Only the newest turn for a task owns the Plan card (avoids jump-up on continue).
          const latestIndexForTask = m.taskId ? latestMessageByTask.get(m.taskId) : undefined;
          const isLatestForTask = !m.taskId || latestIndexForTask === index;
          const showPlan = Boolean(task && taskNeedsPlanCard(task) && isLatestForTask);

          return (
            <div key={m.id} className={`turn ${m.role}${m.streaming ? " streaming" : ""}`}>
              <div className="turn-stack">
                {displayParts.map((part, partIndex) => {
                  const key = part.type === "tool_call" ? part.id : `${part.type}-${partIndex}`;
                  if (part.type === "reasoning") {
                    return (
                      <div key={key} className="message-event message-event-reasoning">
                        <ReasoningBlock text={part.text} streaming={part.streaming} />
                      </div>
                    );
                  }
                  if (part.type === "status") {
                    return <div key={key} className="message-event turn-status meta">{part.text}</div>;
                  }
                  if (part.type === "tool_call") {
                    return (
                      <div key={key} className="message-event message-event-tool">
                        <ToolCallCard part={part} />
                      </div>
                    );
                  }
                  if (part.type === "plan") return null;
                  return (
                    <div key={key} className="message-event message-event-text">
                      <div className="message-event-role">
                        {m.role === "user" ? "You" : m.role === "assistant" ? "IntelaCraft" : "System"}
                      </div>
                      <div className="turn-bubble">
                      {m.role === "assistant" && !m.streaming ? (
                        <MarkdownText className="turn-body" text={part.text} />
                      ) : (
                        <div className="turn-body">{part.text}</div>
                      )}
                      </div>
                    </div>
                  );
                })}

                {m.streaming && !displayParts.some((part) => part.type === "text") && (
                  <div className="turn-bubble"><div className="turn-body" /></div>
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
