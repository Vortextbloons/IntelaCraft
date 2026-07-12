import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createPiSession,
  initializePiSession,
  testProvider,
  type AgentPlan,
  type ChatTurn,
  type InspectionToolName,
  type PlanStreamEvent,
  type ProviderProfile,
  type ThinkingLevel,
} from "@intelacraft/pi-extension";
import { AdvisoryMcpClient } from "@intelacraft/mcp-connection";
import type { ControllerConfig } from "../config.js";
import type { SessionStore, SettingsStore } from "../store.js";
import type { AuditLog } from "../audit.js";
import { getTaskTranscript } from "./chat-history.js";
import { createBoundedInspectionExecutor, executePiInspection } from "./inspection/bridge.js";
import {
  applyAgentVerificationPlan,
  applyPlanToTask,
  validatePlanTools,
} from "./inspection/materialize.js";
import { approveTask } from "./lifecycle/approve.js";
import { cancelTask } from "./lifecycle/cancel.js";
import { onOperationEvent } from "./lifecycle/operations.js";
import { rejectTask } from "./lifecycle/reject.js";
import {
  continueTask,
  createTaskInternal,
  enqueuePendingReads,
} from "./planning/planner.js";
import {
  editAndReplan,
  replanAfterInspection,
  verifyAfterMutations as verifyAfterMutationsImpl,
} from "./planning/replan.js";
import {
  getActiveProvider,
  listProviders,
  loadProviders,
  modelsForProvider,
  needProvider,
  saveProvider,
  setActiveProvider,
  testProviderById,
} from "./provider-store.js";
import {
  deleteTask,
  getTask,
  listTasks,
  loadTasks,
} from "./task-store.js";
import type { AiMode } from "@intelacraft/shared-protocol";
import type { CatalogService } from "../catalog.js";
import type { BuildLibraryStore } from "../build-library/store.js";
import type {
  AgentContext,
  AgentTask,
  CreateTaskInput,
} from "./types.js";

export class AgentRuntime implements AgentContext {
  profiles = new Map<string, ProviderProfile>();
  activeProviderId = "";
  pi = new Map<string, import("@intelacraft/pi-extension").PiSession>();
  tasks = new Map<string, AgentTask>();
  taskPersistenceTimer?: ReturnType<typeof setTimeout>;
  taskPersistencePending = false;
  taskPersistenceInFlight?: Promise<void>;
  settingsRef?: SettingsStore;
  chatHistory = new Map<string, ChatTurn[]>();
  operationEventQueues = new Map<string, Promise<void>>();
  toolCallingSupport = new Map<string, boolean>();
  inspectionWaiters = new Map<string, import("./types.js").InspectionWaiter>();
  thinkingLevel: ThinkingLevel = "off";
  readonly mcp: AdvisoryMcpClient;
  catalog?: CatalogService;
  builds?:BuildLibraryStore;

  constructor(readonly config: ControllerConfig) {
    this.mcp = new AdvisoryMcpClient(config.mcpUrl, config.mcpToken);
    mkdirSync(dirname(config.providersPath), { recursive: true });
    mkdirSync(dirname(config.tasksPath ?? resolve(dirname(config.providersPath), "tasks.json")), { recursive: true });
    loadProviders(this);
    loadTasks(this);
    if (config.providerBaseUrl && config.providerApiKey && config.providerModel) {
      saveProvider(this, {
        id: "default",
        name: "Environment",
        baseUrl: config.providerBaseUrl,
        apiKey: config.providerApiKey,
        model: config.providerModel,
      });
    }
  }

  bindSettings(settings: SettingsStore) {
    this.settingsRef = settings;
  }

  setThinkingLevel(level: ThinkingLevel) {
    this.thinkingLevel = level;
  }

  getThinkingLevel() {
    return this.thinkingLevel;
  }

  saveProvider(p: Partial<ProviderProfile> & Pick<ProviderProfile, "id">) {
    return saveProvider(this, p);
  }

  setActiveProvider(id: string) {
    return setActiveProvider(this, id);
  }

  getActiveProvider() {
    return getActiveProvider(this);
  }

  listProviders() {
    return listProviders(this);
  }

  async test(id: string) {
    return testProviderById(this, id);
  }

  async models(id: string) {
    return modelsForProvider(this, id);
  }

  async createSession(providerId: string) {
    const p = needProvider(this, providerId);
    const supportKey = `${p.baseUrl}\u0000${p.model}`;
    let supportsTools = this.toolCallingSupport.get(supportKey);
    if (supportsTools === undefined) {
      supportsTools = (await testProvider(p)).toolCalling;
      this.toolCallingSupport.set(supportKey, supportsTools);
    }
    // The compatibility probe is intentionally advisory. Some
    // OpenAI-compatible providers accept tools but do not produce a call for
    // this small synthetic prompt; rejecting those models here prevented
    // known-capable models from ever reaching Pi's native tool runtime.
    // Actual plans still require validated native tool calls and fail closed.
    const s = createPiSession(resolve(this.config.piStoragePath), p);
    await initializePiSession(s, p, this.thinkingLevel);
    const effective = s.thinkingLevel ?? this.thinkingLevel;
    if (effective !== "off" && this.thinkingLevel === "off") {
      this.thinkingLevel = effective as ThinkingLevel;
    }
    if (this.settingsRef) {
      this.settingsRef.setEffective(effective);
    }
    this.pi.set(s.id, s);
    return s;
  }

  listSessions() {
    return [...this.pi.values()];
  }

  async createTask(input: CreateTaskInput) {
    return createTaskInternal(this, input);
  }

  async createTaskStream(input: CreateTaskInput, onEvent: (event: PlanStreamEvent) => void) {
    return createTaskInternal(this, input, onEvent);
  }

  async continueTask(
    taskId: string,
    input: {
      request: string;
      worldContext?: unknown;
      useMcp?: boolean;
      mode?: AiMode;
      sessions?: SessionStore;
      audit?: AuditLog;
      history?: ChatTurn[];
    },
    onEvent?: (event: PlanStreamEvent) => void,
  ) {
    return continueTask(this, taskId, input, onEvent);
  }

  async replanAfterInspection(
    taskId: string,
    sessions: SessionStore,
    audit: AuditLog,
    onEvent?: (event: PlanStreamEvent) => void,
  ) {
    return replanAfterInspection(this, taskId, sessions, audit, onEvent);
  }

  async editAndReplan(
    taskId: string,
    input: {
      notes: string;
      sessions: SessionStore;
      audit: AuditLog;
      history?: ChatTurn[];
      onEvent?: (event: PlanStreamEvent) => void;
    },
  ) {
    return editAndReplan(this, taskId, input);
  }

  approveTask(
    taskId: string,
    input: { approvedBy: string; sessions: SessionStore; audit: AuditLog },
  ) {
    return approveTask(this, taskId, input);
  }

  rejectTask(taskId: string, input: { rejectedBy: string; audit: AuditLog; reason?: string }) {
    return rejectTask(this, taskId, input);
  }

  cancelTask(
    taskId: string,
    input: { cancelledBy: string; sessions: SessionStore; audit: AuditLog },
  ) {
    return cancelTask(this, taskId, input);
  }

  async onOperationEvent(
    actionId: string,
    state: string,
    audit: AuditLog,
    detail?: {
      message?: string;
      result?: unknown;
      sessions?: SessionStore;
      toolName?: string;
    },
  ): Promise<void> {
    return onOperationEvent(this, actionId, state, audit, detail);
  }

  getTask(id: string) {
    return getTask(this, id);
  }

  getTaskTranscript(id: string): ChatTurn[] {
    return getTaskTranscript(this, id);
  }

  deleteTask(id: string) {
    return deleteTask(this, id);
  }

  listTasks() {
    return listTasks(this);
  }

  // Test and internal delegates — preserve pre-split instance method access patterns.
  validatePlanTools(plan: AgentPlan, mode?: AiMode) {
    return validatePlanTools(this, plan, mode);
  }

  applyPlanToTask(
    task: AgentTask,
    plan: AgentPlan,
    input: { bdsSessionId: string; actor?: string; permissionMode?: import("@intelacraft/shared-protocol").PermissionMode },
  ) {
    return applyPlanToTask(this, task, plan, input);
  }

  enqueuePendingReads(task: AgentTask, sessions: SessionStore, audit: AuditLog) {
    return enqueuePendingReads(this, task, sessions, audit);
  }

  executePiInspection(
    task: AgentTask,
    toolName: InspectionToolName,
    arguments_: Record<string, unknown>,
    sessions: SessionStore,
    audit: AuditLog,
  ) {
    return executePiInspection(this, task, toolName, arguments_, sessions, audit);
  }

  applyAgentVerificationPlan(task: AgentTask, plan: AgentPlan) {
    return applyAgentVerificationPlan(this, task, plan);
  }

  createBoundedInspectionExecutor(
    task: AgentTask,
    cache: Map<string, Promise<{ message: string; result?: unknown }>>,
    execute: (
      toolName: InspectionToolName,
      arguments_: Record<string, unknown>,
    ) => Promise<{ message: string; result?: unknown }>,
  ) {
    return createBoundedInspectionExecutor(this, task, cache, execute);
  }

  async verifyAfterMutations(taskId: string, sessions: SessionStore, audit: AuditLog) {
    return verifyAfterMutationsImpl(this, taskId, sessions, audit);
  }
}
