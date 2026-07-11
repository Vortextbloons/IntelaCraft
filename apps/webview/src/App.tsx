import { useRef, useState } from "react";
import type { Task } from "./types";
import { Transcript } from "./components/Transcript";
import { ActivityDrawer } from "./features/Drawers/ActivityDrawer";
import { SafetyDrawer } from "./features/Drawers/SafetyDrawer";
import { Composer } from "./features/Composer/Composer";
import { LoginGate } from "./features/LoginGate";
import { TaskList } from "./features/Sidebar/TaskList";
import { useActivity } from "./hooks/useActivity";
import { useAuth } from "./hooks/useAuth";
import { useChatStream } from "./hooks/useChatStream";
import { useConversations, useSelectedTask } from "./hooks/useConversations";
import { useHealth } from "./hooks/useHealth";
import { useProviders } from "./hooks/useProviders";
import { useScroll } from "./hooks/useScroll";
import { useSettings } from "./hooks/useSettings";
import { useTasks } from "./hooks/useTasks";
import { getAiMode } from "./lib/chat-helpers";
import { isTaskActive, type Health, type Provider, type ThinkingLevel, type ToolRun } from "./types";

export function App() {
  const auth = useAuth();
  const activity = useActivity();

  const [health, setHealth] = useState<Health | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("");
  const [drawer, setDrawer] = useState<"none" | "safety" | "activity">("none");
  const [aiMode, setAiMode] = useState<"ask" | "agent">(getAiMode);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [progressByTask, setProgressByTask] = useState<Record<string, ToolRun>>({});
  const [busy, setBusy] = useState(false);

  const streamAbortRef = useRef<AbortController | null>(null);
  const tasksRef = useRef<Task[]>([]);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const setPromptRef = useRef<(value: string) => void>(() => {});
  const updatePiSessionIdRef = useRef<(id: string | null) => void>(() => {});
  const setPermissionModeRef = useRef<(mode: string) => void>(() => {});
  const setThinkingLevelRef = useRef<(level: ThinkingLevel) => void>(() => {});

  const conversations = useConversations({
    authed: auth.authed,
    tasksRef,
    setError: auth.setError,
    setStickToBottom,
    setAiMode,
    streamAbortRef,
    updatePiSessionId: (id) => updatePiSessionIdRef.current(id),
    setProgressByTask,
    setPrompt: (value) => setPromptRef.current(value),
  });

  const tasks = useTasks({
    setError: auth.setError,
    setBusy,
    refresh: () => refreshRef.current(),
    selectedTaskId: conversations.selectedTaskId,
    setSelectedTaskId: conversations.setSelectedTaskId,
    activeConversationId: conversations.activeConversationId,
    setActiveConversationId: conversations.setActiveConversationId,
    setChat: conversations.setChat,
    tasksRef,
  });

  const { refresh } = useHealth({
    authed: auth.authed,
    setAuthed: auth.setAuthed,
    setError: auth.setError,
    setHealth,
    setTasks: tasks.setTasks,
    setProviders,
    setActivity: activity.setActivity,
    setPermissionMode: (mode) => setPermissionModeRef.current(mode),
    setThinkingLevel: (level) => setThinkingLevelRef.current(level),
    setActiveProviderId,
    tasksRef: tasks.tasksRef,
    chatRef: conversations.chatRef,
    setProgressByTask,
    setChat: conversations.setChat,
  });
  refreshRef.current = refresh;

  const providersHook = useProviders({
    authed: auth.authed,
    setError: auth.setError,
    setBusy,
    refresh,
    setChat: conversations.setChat,
    setThinkingLevel: (level) => setThinkingLevelRef.current(level),
    providers,
    setProviders,
    activeProviderId,
    setActiveProviderId,
  });
  updatePiSessionIdRef.current = providersHook.updatePiSessionId;

  const settings = useSettings({
    authed: auth.authed,
    activeProvider: providersHook.activeProvider,
    modelsByProvider: providersHook.modelsByProvider,
    setError: auth.setError,
    setBusy,
    refresh,
  });
  setPermissionModeRef.current = settings.setPermissionMode;
  setThinkingLevelRef.current = settings.setThinkingLevel;

  const chatStream = useChatStream({
    chat: conversations.chat,
    setChat: conversations.setChat,
    chatRef: conversations.chatRef,
    activeConversationId: conversations.activeConversationId,
    setActiveConversationId: conversations.setActiveConversationId,
    setSelectedTaskId: conversations.setSelectedTaskId,
    health,
    aiMode,
    permissionMode: settings.permissionMode,
    piSessionId: providersHook.piSessionId,
    activeProviderId,
    ensurePiSession: providersHook.ensurePiSession,
    refresh,
    setTasks: tasks.setTasks,
    setError: auth.setError,
    setStickToBottom,
    pickerPanel: providersHook.pickerPanel,
    setPickerPanel: providersHook.setPickerPanel,
    streamAbortRef,
    busy,
    setBusy,
  });
  setPromptRef.current = chatStream.setPrompt;

  const selectedTask = useSelectedTask(tasks.tasks, conversations.selectedTaskId);
  // The SSE planning turn can finish while BDS inspection/verification work is
  // still queued. Keep the UI locked until the controller reports a terminal task.
  const aiBusy = busy || tasks.tasks.some(isTaskActive);

  const scroll = useScroll({
    chat: conversations.chat,
    selectedTask,
    progressByTask,
    stickToBottom,
    setStickToBottom,
  });

  if (!auth.authed) {
    return (
      <LoginGate
        tokenInput={auth.tokenInput}
        setTokenInput={auth.setTokenInput}
        error={auth.error}
        onSubmit={auth.login}
      />
    );
  }

  const emergencyOn = health?.sessions?.some((s) => s.emergencyDisabled);

  return (
    <div className="chat-app">
      <TaskList
        tasks={tasks.tasks}
        selectedTaskId={conversations.selectedTaskId}
        activeConversationId={conversations.activeConversationId}
        chatRef={conversations.chatRef}
        health={health}
        activeProvider={providersHook.activeProvider}
        piSessionId={providersHook.piSessionId}
        emergencyOn={Boolean(emergencyOn)}
        drawer={drawer}
        onStartNewChat={conversations.startNewChat}
        onOpenConversation={conversations.openConversation}
        onDeleteTask={tasks.deleteTask}
        onToggleDrawer={(d) => setDrawer(drawer === d ? "none" : d)}
        onSignOut={auth.signOut}
      />

      <div className="workspace">
        <div className="workspace-main">
          {auth.error && <div className="banner-error">{auth.error}</div>}
          {health && !health.bdsConnected && (
            <div className="banner-warn">
              Bedrock server offline — start BDS with IntelaCraft packs so the BDS indicator turns green.
            </div>
          )}

          <div className="chat-column">
            <div
              className="transcript-scroll"
              ref={scroll.transcriptRef}
              onScroll={scroll.onTranscriptScroll}
            >
              <Transcript
                chat={conversations.chat}
                tasks={tasks.tasks}
                progressByTask={progressByTask}
                busy={aiBusy}
                chatEndRef={scroll.chatEndRef}
                showJump={scroll.showJump}
                onJumpLatest={scroll.onJumpLatest}
                onApprove={(task) => void tasks.approveTask(task)}
                onReject={(task) => void tasks.rejectTask(task)}
                onCancel={(task) => void tasks.cancelTask(task)}
                onEditReplan={(task) => void tasks.editAndReplan(task)}
              />
            </div>

            <Composer
              prompt={chatStream.prompt}
              setPrompt={chatStream.setPrompt}
              busy={aiBusy}
              bdsConnected={Boolean(health?.bdsConnected)}
              activeProvider={providersHook.activeProvider}
              providerLabel={providersHook.providerLabel}
              modelLabel={providersHook.modelLabel}
              aiMode={aiMode}
              setAiMode={setAiMode}
              pickerPanel={providersHook.pickerPanel}
              setPickerPanel={providersHook.setPickerPanel}
              pickerRef={providersHook.pickerRef}
              thinkingLevel={settings.thinkingLevel}
              modelCapabilities={settings.modelCapabilities}
              onSubmit={chatStream.submitTask}
              onStop={chatStream.stopStreaming}
              onOpenModelsPanel={providersHook.openModelsPanel}
              onPatchThinking={settings.patchThinking}
              providerChoices={providersHook.providerChoices}
              browseProviderId={providersHook.browseProviderId}
              connectKey={providersHook.connectKey}
              setConnectKey={providersHook.setConnectKey}
              customBaseUrl={providersHook.customBaseUrl}
              setCustomBaseUrl={providersHook.setCustomBaseUrl}
              showAdvanced={providersHook.showAdvanced}
              setShowAdvanced={providersHook.setShowAdvanced}
              showKeyUpdate={providersHook.showKeyUpdate}
              setShowKeyUpdate={providersHook.setShowKeyUpdate}
              modelsLoading={providersHook.modelsLoading}
              savedProvider={providersHook.savedProvider}
              catalogFor={providersHook.catalogFor}
              onOpenProvider={providersHook.openProvider}
              onConnectProvider={providersHook.connectProvider}
              onTestBrowseProvider={providersHook.testBrowseProvider}
              onRefreshCatalog={providersHook.refreshCatalog}
              connectedProviders={providersHook.connectedProviders}
              filteredModelGroups={providersHook.filteredModelGroups}
              modelFilter={providersHook.modelFilter}
              setModelFilter={providersHook.setModelFilter}
              modelQuery={providersHook.modelQuery}
              modelSearchRef={providersHook.modelSearchRef}
              onRefreshAllCatalogs={providersHook.refreshAllCatalogs}
              onSelectModel={providersHook.selectModel}
            />
          </div>
        </div>

        {drawer !== "none" && (
          <aside className="chat-drawer">
            {drawer === "safety" && (
              <SafetyDrawer
                permissionMode={settings.permissionMode}
                thinkingLevel={settings.thinkingLevel}
                modelCapabilities={settings.modelCapabilities}
                busy={aiBusy}
                emergencyOn={Boolean(emergencyOn)}
                onPatchMode={settings.patchMode}
                onPatchThinking={settings.patchThinking}
                onEmergency={settings.emergency}
              />
            )}
            {drawer === "activity" && (
              <ActivityDrawer
                activityFilter={activity.activityFilter}
                setActivityFilter={activity.setActivityFilter}
                filteredActivity={activity.filteredActivity}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

export { ConnDot } from "./components/ConnectionStrip";
