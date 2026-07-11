import type { MutableRefObject } from "react";
import { saveConversation } from "../../chatStore";
import { ConnectionStrip } from "../../components/ConnectionStrip";
import { WorldContextPanel } from "../../components/WorldContextPanel";
import type { ChatMsg, Health, Provider, Task } from "../../types";

type TaskListProps = {
  tasks: Task[];
  selectedTaskId: string | null;
  activeConversationId: string | null;
  chatRef: MutableRefObject<ChatMsg[]>;
  health: Health | null;
  activeProvider: Provider | null;
  piSessionId: string | null;
  emergencyOn: boolean;
  drawer: "none" | "safety" | "activity";
  onStartNewChat: () => void;
  onOpenConversation: (taskId: string) => void;
  onDeleteTask: (id: string) => void;
  onToggleDrawer: (drawer: "safety" | "activity") => void;
  onSignOut: () => void;
};

export function TaskList({
  tasks,
  selectedTaskId,
  activeConversationId,
  chatRef,
  health,
  activeProvider,
  piSessionId,
  emergencyOn,
  drawer,
  onStartNewChat,
  onOpenConversation,
  onDeleteTask,
  onToggleDrawer,
  onSignOut,
}: TaskListProps) {
  const mcp = health?.agent?.mcp;
  const sessionConnected = Boolean(piSessionId) || (health?.agent?.sessions ?? 0) > 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">IntelaCraft</div>
      <button type="button" className="sidebar-new" onClick={onStartNewChat}>
        New chat
      </button>
      <div className="sidebar-threads" aria-label="Tasks">
        {tasks.length === 0 ? (
          <div className="sidebar-empty">No threads yet</div>
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              className={t.id === selectedTaskId ? "thread-item active" : "thread-item"}
            >
              <button
                type="button"
                className="thread-select"
                onClick={() => {
                  if (activeConversationId && activeConversationId !== t.id) {
                    saveConversation(activeConversationId, chatRef.current);
                  }
                  void onOpenConversation(t.id);
                }}
              >
                <span className="thread-title">{t.request || t.id}</span>
                <span className="thread-meta">{t.state}</span>
              </button>
              <button
                type="button"
                className="thread-delete"
                title="Delete thread"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTask(t.id);
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
      <div className="sidebar-footer">
        <WorldContextPanel health={health} />
        <ConnectionStrip
          bds={Boolean(health?.bdsConnected)}
          model={Boolean(activeProvider)}
          session={sessionConnected}
          mcp={mcp}
          emergency={Boolean(emergencyOn)}
        />
        <div className="sidebar-links">
          <button
            type="button"
            className={drawer === "safety" ? "ghost active" : "ghost"}
            onClick={() => onToggleDrawer("safety")}
          >
            Safety
          </button>
          <button
            type="button"
            className={drawer === "activity" ? "ghost active" : "ghost"}
            onClick={() => onToggleDrawer("activity")}
          >
            Activity
          </button>
          <button type="button" className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
