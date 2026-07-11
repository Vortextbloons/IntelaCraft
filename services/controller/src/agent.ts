import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createActionRequest,
  newId,
  validateToolArguments,
  type ActionRequestMessage,
  type PermissionMode,
  type RiskClass,
  type ToolName,
} from "@intelacraft/shared-protocol";
import {
  createPiSession,
  discoverModels,
  initializePiSession,
  injectPiToolResult,
  planWithPiSession,
  publicProfile,
  redactSecrets,
  refreshPiSessionProvider,
  setPiInspectionExecutor,
  testProvider,
  type AgentPlan,
  type ChatTurn,
  type PiSession,
  type PlanStreamEvent,
  type ProviderProfile,
  type ThinkingLevel,
  type InspectionToolName,
} from "@intelacraft/pi-extension";
import { AdvisoryMcpClient } from "@intelacraft/mcp-connection";
import type { ControllerConfig } from "./config.js";
import { classify, payloadHash } from "./policy.js";
import type { SessionStore } from "./store.js";
import type { AuditLog } from "./audit.js";

export type AgentTaskState =
  | "submitted"
  | "planning"
  | "inspecting"
  | "awaiting_approval"
  | "planned"
  | "running"
  | "verifying"
  | "rejected"
  | "cancelled"
  | "completed"
  | "partial"
  | "failed";

export interface AgentTask {
  id: string;
  piSessionId: string;
  request: string;
  state: AgentTaskState;
  createdAt: string;
  updatedAt: string;
  plan?: AgentPlan;
  /** Mutations awaiting approval, or inspect-only actions once materialized. */
  proposedActions?: ActionRequestMessage[];
  /** Read-only inspection actions auto-enqueued without approval. */
  pendingReads?: ActionRequestMessage[];
  /** Verification reads to run after mutations. */
  pendingVerification?: ActionRequestMessage[];
  enqueuedActionIds?: string[];
  completedActionIds?: string[];
  /** Action IDs that belong to the current inspect wave (for replan gating). */
  inspectActionIds?: string[];
  /** Action IDs that belong to mutation wave. */
  mutationActionIds?: string[];
  /** Action IDs that belong to verification wave. */
  verifyActionIds?: string[];
  /** Exact tool attribution for every materialized action, keyed by action ID. */
  actionToolNames?: Record<string, string>;
  error?: string;
  bdsSessionId?: string;
  actor?: string;
  permissionMode?: PermissionMode;
  metrics?: {
    planLatencyMs?: number;
    validationRetries?: number;
    usedNormalizeFallback?: boolean;
  };
  /** True when we deferred mutations until inspect completes + replan. */
  awaitingInspectReplan?: boolean;
}

interface ProvidersFile {
  activeProviderId: string;
  providers: ProviderProfile[];
}

export class AgentRuntime {
  private profiles = new Map<string, ProviderProfile>();
  private activeProviderId = "";
  private pi = new Map<string, PiSession>();
  private tasks = new Map<string, AgentTask>();
  /** Multi-turn chat memory keyed by Pi session id. */
  private chatHistory = new Map<string, ChatTurn[]>();
  /** Serialize operation events per task so observations cannot race replanning. */
  private operationEventQueues = new Map<string, Promise<void>>();
  private inspectionWaiters = new Map<
    string,
    {
      resolve: (value: { message: string; result?: unknown }) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private thinkingLevel: ThinkingLevel = "off";
  readonly mcp: AdvisoryMcpClient;

  constructor(private config: ControllerConfig) {
    this.mcp = new AdvisoryMcpClient(config.mcpUrl, config.mcpToken);
    this.loadProviders();
    if (config.providerBaseUrl && config.providerApiKey && config.providerModel) {
      this.saveProvider({
        id: "default",
        name: "Environment",
        baseUrl: config.providerBaseUrl,
        apiKey: config.providerApiKey,
        model: config.providerModel,
      });
    }
  }

  setThinkingLevel(level: ThinkingLevel) {
    this.thinkingLevel = level;
  }

  getThinkingLevel() {
    return this.thinkingLevel;
  }

  private loadProviders(): void {
    try {
      if (!existsSync(this.config.providersPath)) return;
      const raw = JSON.parse(readFileSync(this.config.providersPath, "utf8")) as ProvidersFile;
      const rows = Array.isArray(raw?.providers) ? raw.providers : [];
      for (const row of rows) {
        if (!row?.id || !row.baseUrl || !row.apiKey || !row.model) continue;
        let apiKey: string;
        try {
          apiKey = sanitizeApiKey(String(row.apiKey));
        } catch {
          console.error(`Skipping provider ${row.id}: invalid API key in providers.json`);
          continue;
        }
        this.profiles.set(row.id, {
          id: String(row.id),
          name: String(row.name || row.id),
          baseUrl: String(row.baseUrl).replace(/\/$/, ""),
          apiKey,
          model: String(row.model),
        });
      }
      const active = String(raw.activeProviderId ?? "");
      this.activeProviderId =
        (active && this.profiles.has(active) && active) ||
        this.profiles.keys().next().value ||
        "";
    } catch (err) {
      console.error("Failed to load providers file:", err);
    }
  }

  private persistProviders(): void {
    const payload: ProvidersFile = {
      activeProviderId: this.activeProviderId,
      providers: [...this.profiles.values()],
    };
    mkdirSync(dirname(this.config.providersPath), { recursive: true });
    writeFileSync(this.config.providersPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  saveProvider(p: Partial<ProviderProfile> & Pick<ProviderProfile, "id">) {
    const prev = this.profiles.get(p.id);
    const baseUrl = (p.baseUrl ?? prev?.baseUrl ?? "").replace(/\/$/, "");
    const model = p.model ?? prev?.model ?? "";
    let apiKey = p.apiKey?.trim() || prev?.apiKey || "";
    if (p.apiKey != null && p.apiKey.trim()) {
      apiKey = sanitizeApiKey(p.apiKey);
    }
    if (!p.id || !baseUrl || !model) {
      throw new Error("Provider id, baseUrl, and model are required");
    }
    if (!apiKey) throw new Error("API key is required — connect the provider first");
    const next: ProviderProfile = {
      id: p.id,
      name: p.name || prev?.name || p.id,
      baseUrl,
      apiKey,
      model,
    };
    this.profiles.set(p.id, next);
    this.activeProviderId = p.id;
    this.persistProviders();
    return publicProfile(next);
  }

  setActiveProvider(id: string) {
    if (!this.profiles.has(id)) throw new Error("Unknown provider profile");
    this.activeProviderId = id;
    this.persistProviders();
    return this.getActiveProvider();
  }

  getActiveProvider() {
    const id =
      (this.activeProviderId && this.profiles.has(this.activeProviderId) && this.activeProviderId) ||
      this.profiles.keys().next().value ||
      "";
    return {
      activeProviderId: id,
      provider: id ? publicProfile(this.profiles.get(id)!) : null,
    };
  }

  listProviders() {
    return [...this.profiles.values()].map(publicProfile);
  }

  async test(id: string) {
    return testProvider(this.needProvider(id));
  }

  async models(id: string) {
    return discoverModels(this.needProvider(id));
  }

  async createSession(providerId: string) {
    const p = this.needProvider(providerId);
    const s = createPiSession(resolve(this.config.piStoragePath), p);
    await initializePiSession(s, p, this.thinkingLevel);
    this.pi.set(s.id, s);
    return s;
  }

  listSessions() {
    return [...this.pi.values()];
  }

  async createTask(input: {
    piSessionId: string;
    request: string;
    worldContext?: unknown;
    useMcp?: boolean;
    permissionMode?: PermissionMode;
    bdsSessionId: string;
    actor?: string;
    sessions?: SessionStore;
    audit?: AuditLog;
    history?: ChatTurn[];
  }) {
    return this.createTaskInternal(input);
  }

  /** Same as createTask but streams model tokens via onEvent. */
  async createTaskStream(
    input: {
      piSessionId: string;
      request: string;
      worldContext?: unknown;
      useMcp?: boolean;
      permissionMode?: PermissionMode;
      bdsSessionId: string;
      actor?: string;
      sessions?: SessionStore;
      audit?: AuditLog;
      history?: ChatTurn[];
    },
    onEvent: (event: PlanStreamEvent) => void,
  ) {
    return this.createTaskInternal(input, onEvent);
  }

  /** Continue an existing task conversation — sends a follow-up to the same Pi session. */
  async continueTask(
    taskId: string,
    input: {
      request: string;
      worldContext?: unknown;
      useMcp?: boolean;
      sessions?: SessionStore;
      audit?: AuditLog;
      history?: ChatTurn[];
    },
    onEvent?: (event: PlanStreamEvent) => void,
  ) {
    const task = this.tasks.get(taskId);
    if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
    if (task.state === "planning") {
      throw Object.assign(new Error("Task is already planning — wait for it to finish"), {
        code: "INVALID_STATE",
        status: 409,
      });
    }
    const s = this.pi.get(task.piSessionId);
    if (!s) throw new Error("Pi session missing for task");
    task.state = "planning";
    task.error = undefined;
    task.proposedActions = [];
    task.pendingReads = [];
    task.pendingVerification = [];
    task.enqueuedActionIds = [];
    task.completedActionIds = [];
    task.inspectActionIds = [];
    task.mutationActionIds = [];
    task.verifyActionIds = [];
    task.awaitingInspectReplan = false;
    task.updatedAt = new Date().toISOString();
    input.audit?.append({ type: "task_lifecycle", taskId: task.id, state: task.state, phase: "continue" });
    onEvent?.({ type: "status", text: "Planning response…" });
    const planStarted = Date.now();
    try {
      const advice = input.useMcp === false ? null : await this.mcp.query(input.request);
      const provider = this.needProvider(s.providerId);
      await refreshPiSessionProvider(s, provider, this.thinkingLevel);
      const world = this.buildWorldContext(input.sessions, input.worldContext);
      const mcp = advice == null ? undefined : redactSecrets(advice);
      const history = this.resolveHistory(s.id, input.history);
      const adminCommandIds = Object.keys(this.config.adminCommands);
      const plan = await this.planWithValidationRetry(
        s.id,
        input.request,
        world,
        mcp,
        {
          thinkingLevel: this.thinkingLevel,
          adminCommandIds,
          history,
          onEvent,
        },
        task,
        {
          bdsSessionId: task.bdsSessionId!,
          actor: task.actor,
          permissionMode: task.permissionMode,
        },
      );
      task.request = `${task.request}\n\nFollow-up: ${input.request}`;
      this.applyPlanToTask(task, plan, {
        bdsSessionId: task.bdsSessionId!,
        actor: task.actor,
        permissionMode: task.permissionMode,
      });
      this.appendHistory(s.id, { role: "user", content: input.request });
      this.appendHistory(s.id, {
        role: "assistant",
        content: this.planHistoryText(plan),
      });
      if (input.sessions && input.audit) {
        this.enqueuePendingReads(task, input.sessions, input.audit);
      }
    } catch (e) {
      task.state = "failed";
      task.error = e instanceof Error ? e.message : "Continue failed";
    }
    task.metrics = {
      ...(task.metrics ?? {}),
      planLatencyMs: Date.now() - planStarted,
    };
    task.updatedAt = new Date().toISOString();
    return this.publicTask(task);
  }

  private buildWorldContext(sessions?: SessionStore, clientWorld?: unknown): unknown {
    const live = sessions?.listSessions()?.[0];
    const health = live?.lastHealth;
    const server = {
      serverId: live?.serverId,
      connected: Boolean(live),
      emergencyDisabled: live ? sessions?.isEmergencyDisabled(live.sessionId) : false,
      playersOnline: health?.playerCount,
      tick: health?.tick,
      ok: health?.ok,
    };
    return redactSecrets({
      server,
      client: clientWorld ?? {},
      adminCommandIds: Object.keys(this.config.adminCommands),
    });
  }

  private async createTaskInternal(
    input: {
      piSessionId: string;
      request: string;
      worldContext?: unknown;
      useMcp?: boolean;
      permissionMode?: PermissionMode;
      bdsSessionId: string;
      actor?: string;
      sessions?: SessionStore;
      audit?: AuditLog;
      history?: ChatTurn[];
    },
    onEvent?: (event: PlanStreamEvent) => void,
  ) {
    const s = this.pi.get(input.piSessionId);
    if (!s) throw new Error("Unknown Pi session");
    const task: AgentTask = {
      id: newId("task"),
      piSessionId: s.id,
      request: input.request,
      state: "submitted",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bdsSessionId: input.bdsSessionId,
      actor: input.actor ?? "pi-agent",
      permissionMode: input.permissionMode ?? this.config.defaultPermissionMode,
      completedActionIds: [],
      metrics: { validationRetries: 0 },
    };
    this.tasks.set(task.id, task);
    task.state = "planning";
    // Structured tool-call responses may contain no visible text deltas.
    onEvent?.({ type: "status", text: "Planning response…" });
    const planStarted = Date.now();
    try {
      const advice = input.useMcp === false ? null : await this.mcp.query(input.request);
      const provider = this.needProvider(s.providerId);
      await refreshPiSessionProvider(s, provider, this.thinkingLevel);
      const world = this.buildWorldContext(input.sessions, input.worldContext);
      const mcp = advice == null ? undefined : redactSecrets(advice);
      const history = this.resolveHistory(s.id, input.history);
      const adminCommandIds = Object.keys(this.config.adminCommands);

      const plan = await this.planWithValidationRetry(
        s.id,
        input.request,
        world,
        mcp,
        {
          thinkingLevel: this.thinkingLevel,
          adminCommandIds,
          history,
          onEvent,
        },
        task,
        input,
      );

      this.applyPlanToTask(task, plan, input);
      this.appendHistory(s.id, { role: "user", content: input.request });
      this.appendHistory(s.id, {
        role: "assistant",
        content: this.planHistoryText(plan),
      });
      if (input.sessions && input.audit) {
        this.enqueuePendingReads(task, input.sessions, input.audit);
      }
    } catch (e) {
      task.state = "failed";
      task.error = e instanceof Error ? e.message : "Planning failed";
    }
    task.metrics = {
      ...(task.metrics ?? {}),
      planLatencyMs: Date.now() - planStarted,
    };
    task.updatedAt = new Date().toISOString();
    return this.publicTask(task);
  }

  private async planWithValidationRetry(
    sessionId: string,
    request: string,
    world: unknown,
    mcp: unknown,
    opts: {
      thinkingLevel?: ThinkingLevel;
      adminCommandIds?: string[];
      history?: ChatTurn[];
      onEvent?: (event: PlanStreamEvent) => void;
      validationError?: string;
    },
    task: AgentTask,
    input: {
      bdsSessionId: string;
      actor?: string;
      permissionMode?: PermissionMode;
      sessions?: SessionStore;
      audit?: AuditLog;
    },
  ): Promise<AgentPlan> {
    if (input.sessions && input.audit) {
      setPiInspectionExecutor(sessionId, (toolName, arguments_) =>
        this.executePiInspection(task, toolName, arguments_, input.sessions!, input.audit!),
      );
    }
    let lastError: string | undefined = opts.validationError;
    // Pi may finish the prompt before its queued tool callback is dispatched.
    // Keep the bridge bound to this Pi session until a later planning turn
    // replaces it; clearing it here caused those callbacks to fail before an
    // inspection action could be sent to BDS.
    for (let attempt = 0; attempt < 2; attempt++) {
      const plan = await planWithPiSession(sessionId, request, world, mcp, {
        ...opts,
        validationError: lastError,
      });
      try {
        this.validatePlanTools(plan);
        // Dry-run materialize to catch arg errors before applying.
        for (const step of plan.inspection) this.materializeAction(step, input, true);
        for (const step of plan.actions) this.materializeAction(step, input, false);
        for (const step of plan.verification) this.materializeAction(step, input, true);
        return plan;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "Invalid plan";
        task.metrics = {
          ...(task.metrics ?? {}),
          validationRetries: (task.metrics?.validationRetries ?? 0) + 1,
        };
        if (attempt === 1) throw e;
        opts.onEvent?.({
          type: "tool",
          name: "validate_plan",
          phase: "start",
          detail: lastError,
        });
      }
    }
    throw new Error(lastError ?? "Planning failed");
  }

  private async executePiInspection(
    task: AgentTask,
    toolName: InspectionToolName,
    arguments_: Record<string, unknown>,
    sessions: SessionStore,
    audit: AuditLog,
  ): Promise<{ message: string; result?: unknown }> {
    const action = this.materializeAction(
      { toolName, arguments: arguments_ },
      {
        bdsSessionId: task.bdsSessionId!,
        actor: task.actor,
        permissionMode: task.permissionMode,
      },
      true,
    );
    const queued = sessions.enqueue(action.sessionId, action);
    if (!queued.ok) throw new Error(queued.message);
    task.enqueuedActionIds = [...(task.enqueuedActionIds ?? []), action.actionId];
    task.inspectActionIds = [...(task.inspectActionIds ?? []), action.actionId];
    task.actionToolNames = { ...(task.actionToolNames ?? {}), [action.actionId]: action.toolName };
    task.state = "inspecting";
    audit.append({
      type: "action_enqueued",
      taskId: task.id,
      sessionId: action.sessionId,
      actionId: action.actionId,
      toolName: action.toolName,
      actor: action.actor,
      risk: action.risk,
      arguments: action.arguments,
      noApprovalReason: "agent_inspection",
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inspectionWaiters.delete(action.actionId);
        reject(new Error(`${toolName} timed out waiting for the Bedrock server`));
      }, 30_000);
      this.inspectionWaiters.set(action.actionId, { resolve, reject, timer });
    });
  }

  private validatePlanTools(plan: AgentPlan) {
    for (const step of [...plan.inspection, ...plan.verification]) {
      if (!step.toolName.startsWith("inspect.")) {
        throw new Error("Inspection and verification steps must be read-only");
      }
    }
  }

  private resolveHistory(piSessionId: string, clientHistory?: ChatTurn[]): ChatTurn[] {
    const stored = this.chatHistory.get(piSessionId) ?? [];
    if (!clientHistory?.length) return stored.slice(-16);
    const normalized = clientHistory
      .filter((t) => (t.role === "user" || t.role === "assistant") && t.content?.trim())
      .map((t) => ({ role: t.role, content: String(t.content).slice(0, 4000) }))
      .slice(-16);
    // Client transcript is the source of truth for the open chat thread.
    this.chatHistory.set(piSessionId, normalized);
    return normalized;
  }

  private appendHistory(piSessionId: string, turn: ChatTurn) {
    const rows = this.chatHistory.get(piSessionId) ?? [];
    rows.push({ role: turn.role, content: turn.content.slice(0, 4000) });
    while (rows.length > 32) rows.shift();
    this.chatHistory.set(piSessionId, rows);
  }

  private planHistoryText(plan: AgentPlan): string {
    const bits = [plan.summary];
    for (const step of plan.inspection) {
      bits.push(`[inspect] ${step.toolName}: ${step.summary}`);
    }
    for (const step of plan.actions) {
      bits.push(`[action] ${step.toolName}: ${step.summary}`);
    }
    if (plan.notes?.length) bits.push(`notes: ${plan.notes.join("; ")}`);
    return bits.filter(Boolean).join("\n").slice(0, 4000);
  }

  private materializeAction(
    step: { toolName: string; arguments: Record<string, unknown> },
    input: { bdsSessionId: string; actor?: string; permissionMode?: PermissionMode },
    forceRead: boolean,
  ): ActionRequestMessage {
    const policy = {
      protectedRegions: this.config.protectedRegions,
      builderRegions: this.config.builderRegions,
      adminCommands: this.config.adminCommands,
    };
    const tool = step.toolName as ToolName;
    let args = step.arguments;
    if (tool === "admin.run_command") {
      const commandId = String(args.commandId ?? "");
      const entry = this.config.adminCommands[commandId];
      if (!entry) throw new Error(`Unknown admin commandId '${commandId}'`);
      args = { commandId, command: entry.command };
    }
    const valid = validateToolArguments(tool, args);
    if (!valid.ok) throw new Error(`Invalid model tool ${step.toolName}: ${valid.error.message}`);
    const draft = createActionRequest({
      sessionId: input.bdsSessionId,
      requestId: newId("req"),
      actionId: newId("action"),
      idempotencyKey: newId("idem"),
      toolName: tool,
      arguments: valid.value,
      actor: input.actor ?? "pi-agent",
      permissionMode: input.permissionMode ?? this.config.defaultPermissionMode,
      risk: forceRead || tool.startsWith("inspect.") ? "read" : "normal",
    });
    const c = classify(draft, policy);
    return {
      ...draft,
      risk: c.risk as RiskClass,
      noApprovalReason: c.risk === "read" ? "read_risk_no_approval" : undefined,
    };
  }

  private applyPlanToTask(
    task: AgentTask,
    plan: AgentPlan,
    input: { bdsSessionId: string; actor?: string; permissionMode?: PermissionMode },
  ) {
    this.validatePlanTools(plan);
    for (const step of [...plan.inspection, ...plan.verification]) {
      const v = validateToolArguments(step.toolName as ToolName, step.arguments);
      if (!v.ok) throw new Error(`Invalid ${step.toolName}: ${v.error.message}`);
    }
    const reads = plan.inspection.map((step) => this.materializeAction(step, input, true));
    const proposed = plan.actions.map((a) => this.materializeAction(a, input, false));
    const verification = plan.verification.map((step) => this.materializeAction(step, input, true));
    task.plan = plan;
    task.pendingReads = reads;
    task.pendingVerification = verification;
    task.proposedActions = proposed;
    task.awaitingInspectReplan = false;
    task.inspectActionIds = [];
    task.mutationActionIds = [];
    task.verifyActionIds = [];
    task.actionToolNames = Object.fromEntries(
      [...reads, ...proposed, ...verification].map((action) => [action.actionId, action.toolName]),
    );

    const chatOnly =
      plan.inspection.length === 0 &&
      plan.actions.length === 0 &&
      plan.verification.length === 0;
    if (chatOnly) {
      task.state = "completed";
    } else if (reads.length > 0 && proposed.some((a) => a.risk !== "read")) {
      // Defer mutation approval until inspect completes and we re-plan.
      task.awaitingInspectReplan = true;
      task.proposedActions = [];
      task.state = "inspecting";
    } else if (proposed.some((a) => a.risk !== "read")) {
      task.state = "awaiting_approval";
    } else if (reads.length > 0) {
      task.proposedActions = reads;
      task.state = "planned";
    } else {
      task.state = "planned";
    }
  }

  /** Enqueue pending read-only inspect actions without an approval record. */
  private enqueuePendingReads(task: AgentTask, sessions: SessionStore, audit: AuditLog) {
    const actions = task.pendingReads ?? [];
    if (actions.length === 0) {
      if (task.state === "planned" && (task.proposedActions?.length ?? 0) === 0) {
        task.state = "completed";
        audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
      }
      return;
    }
    const enqueued: string[] = [...(task.enqueuedActionIds ?? [])];
    const inspectIds: string[] = [...(task.inspectActionIds ?? [])];
    for (const action of actions) {
      const result = sessions.enqueue(action.sessionId, {
        ...action,
        noApprovalReason: "read_risk_no_approval",
      });
      if (!result.ok) {
        task.state = "failed";
        task.error = result.message;
        audit.append({
          type: "task_lifecycle",
          taskId: task.id,
          state: task.state,
          error: result.message,
        });
        return;
      }
      enqueued.push(action.actionId);
      inspectIds.push(action.actionId);
      audit.append({
        type: "action_enqueued",
        taskId: task.id,
        sessionId: action.sessionId,
        actionId: action.actionId,
        toolName: action.toolName,
        actor: action.actor,
        risk: action.risk,
        arguments: action.arguments,
        noApprovalReason: "read_risk_no_approval",
      });
    }
    task.enqueuedActionIds = enqueued;
    task.inspectActionIds = inspectIds;
    task.pendingReads = [];
    if (task.state === "planned") {
      task.state = "running";
      audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    } else if (task.state === "inspecting") {
      audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    }
  }

  private enqueueVerification(task: AgentTask, sessions: SessionStore, audit: AuditLog) {
    const actions = task.pendingVerification ?? [];
    if (actions.length === 0) {
      task.state = "completed";
      audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
      return;
    }
    task.state = "verifying";
    const enqueued: string[] = [...(task.enqueuedActionIds ?? [])];
    const verifyIds: string[] = [];
    for (const action of actions) {
      const result = sessions.enqueue(action.sessionId, {
        ...action,
        noApprovalReason: "read_risk_no_approval",
      });
      if (!result.ok) {
        task.state = "partial";
        task.error = result.message;
        audit.append({
          type: "task_lifecycle",
          taskId: task.id,
          state: task.state,
          error: result.message,
        });
        return;
      }
      enqueued.push(action.actionId);
      verifyIds.push(action.actionId);
      audit.append({
        type: "action_enqueued",
        taskId: task.id,
        sessionId: action.sessionId,
        actionId: action.actionId,
        toolName: action.toolName,
        actor: action.actor,
        risk: action.risk,
        arguments: action.arguments,
        noApprovalReason: "verification_read",
      });
    }
    task.enqueuedActionIds = enqueued;
    task.verifyActionIds = verifyIds;
    task.pendingVerification = [];
    audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
  }

  /** After inspect wave completes, re-plan mutations with real world facts. */
  async replanAfterInspection(
    taskId: string,
    sessions: SessionStore,
    audit: AuditLog,
    onEvent?: (event: PlanStreamEvent) => void,
  ) {
    const task = this.tasks.get(taskId);
    if (!task || !task.awaitingInspectReplan) return this.publicTask(task!);
    const s = this.pi.get(task.piSessionId);
    if (!s) {
      task.state = "failed";
      task.error = "Pi session missing for replan";
      return this.publicTask(task);
    }
    task.state = "planning";
    task.awaitingInspectReplan = false;
    audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state, phase: "replan" });
    try {
      const provider = this.needProvider(s.providerId);
      await refreshPiSessionProvider(s, provider, this.thinkingLevel);
      const world = this.buildWorldContext(sessions);
      const history = this.chatHistory.get(s.id) ?? [];
      const plan = await this.planWithValidationRetry(
        s.id,
        `Inspection finished for the original request. Propose the final mutation plan now (prefer empty inspection if facts are known).\nOriginal request: ${task.request}`,
        world,
        undefined,
        {
          thinkingLevel: this.thinkingLevel,
          adminCommandIds: Object.keys(this.config.adminCommands),
          history,
          onEvent,
        },
        task,
        {
          bdsSessionId: task.bdsSessionId!,
          actor: task.actor,
          permissionMode: task.permissionMode,
          sessions,
          audit,
        },
      );
      // Keep original request on the task; apply refined plan.
      this.applyPlanToTask(task, plan, {
        bdsSessionId: task.bdsSessionId!,
        actor: task.actor,
        permissionMode: task.permissionMode,
      });
      // If replan still wants inspect-only deferral, just enqueue reads again.
      const nextState = task.state as AgentTaskState;
      if (nextState === "inspecting" || (nextState === "planned" && (task.pendingReads?.length ?? 0) > 0)) {
        this.enqueuePendingReads(task, sessions, audit);
      }
      this.appendHistory(s.id, {
        role: "assistant",
        content: this.planHistoryText(plan),
      });
    } catch (e) {
      task.state = "failed";
      task.error = e instanceof Error ? e.message : "Replan failed";
    }
    task.updatedAt = new Date().toISOString();
    audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    return this.publicTask(task);
  }

  /** Edit-and-replan: reject current mutations and plan again with user notes. */
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
    const task = this.tasks.get(taskId);
    if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
    if (task.state !== "awaiting_approval" && task.state !== "planned" && task.state !== "inspecting") {
      throw Object.assign(new Error(`Task cannot be edited in state ${task.state}`), {
        code: "INVALID_STATE",
        status: 409,
      });
    }
    const s = this.pi.get(task.piSessionId);
    if (!s) throw new Error("Unknown Pi session");
    task.state = "planning";
    task.error = undefined;
    input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state, phase: "edit_replan" });
    const request = `${task.request}\n\nUser edit notes: ${input.notes}`;
    try {
      const provider = this.needProvider(s.providerId);
      await refreshPiSessionProvider(s, provider, this.thinkingLevel);
      const world = this.buildWorldContext(input.sessions);
      const history = this.resolveHistory(s.id, input.history);
      const plan = await this.planWithValidationRetry(
        s.id,
        request,
        world,
        undefined,
        {
          thinkingLevel: this.thinkingLevel,
          adminCommandIds: Object.keys(this.config.adminCommands),
          history,
          onEvent: input.onEvent,
        },
        task,
        {
          bdsSessionId: task.bdsSessionId!,
          actor: task.actor,
          permissionMode: task.permissionMode,
          sessions: input.sessions,
          audit: input.audit,
        },
      );
      task.request = request;
      this.applyPlanToTask(task, plan, {
        bdsSessionId: task.bdsSessionId!,
        actor: task.actor,
        permissionMode: task.permissionMode,
      });
      this.enqueuePendingReads(task, input.sessions, input.audit);
      this.appendHistory(s.id, { role: "user", content: input.notes });
      this.appendHistory(s.id, { role: "assistant", content: this.planHistoryText(plan) });
    } catch (e) {
      task.state = "failed";
      task.error = e instanceof Error ? e.message : "Edit replan failed";
    }
    task.updatedAt = new Date().toISOString();
    return this.publicTask(task);
  }

  approveTask(
    taskId: string,
    input: { approvedBy: string; sessions: SessionStore; audit: AuditLog },
  ) {
    const task = this.tasks.get(taskId);
    if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
    if (task.state !== "awaiting_approval" && task.state !== "planned") {
      throw Object.assign(new Error(`Task cannot be approved in state ${task.state}`), {
        code: "INVALID_STATE",
        status: 409,
      });
    }
    const actions = task.proposedActions ?? [];
    if (actions.length === 0) {
      task.state = "completed";
      task.updatedAt = new Date().toISOString();
      input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
      return this.publicTask(task);
    }
    const enqueued: string[] = [...(task.enqueuedActionIds ?? [])];
    const mutationIds: string[] = [];
    for (const action of actions) {
      if (action.risk === "read") {
        // Already auto-enqueued via enqueuePendingReads — skip duplicates.
        if (enqueued.includes(action.actionId)) continue;
        const result = input.sessions.enqueue(action.sessionId, {
          ...action,
          noApprovalReason: "read_risk_no_approval",
        });
        if (!result.ok) {
          throw Object.assign(new Error(result.message), { code: result.code, status: 409 });
        }
        enqueued.push(action.actionId);
        input.audit.append({
          type: "action_enqueued",
          taskId: task.id,
          sessionId: action.sessionId,
          actionId: action.actionId,
          toolName: action.toolName,
          actor: action.actor,
          risk: action.risk,
          arguments: action.arguments,
        });
        continue;
      }
      const hash = payloadHash(action);
      const approved: ActionRequestMessage = {
        ...action,
        approval: {
          approvalId: newId("approval"),
          approvedAt: new Date().toISOString(),
          approvedBy: input.approvedBy,
          payloadHash: hash,
        },
        noApprovalReason: undefined,
      };
      if (input.sessions.isEmergencyDisabled(approved.sessionId)) {
        throw Object.assign(new Error("Mutations are disabled"), {
          code: "EMERGENCY_DISABLED",
          status: 503,
        });
      }
      const result = input.sessions.enqueue(approved.sessionId, approved);
      if (!result.ok) {
        throw Object.assign(new Error(result.message), { code: result.code, status: 409 });
      }
      enqueued.push(approved.actionId);
      mutationIds.push(approved.actionId);
      input.audit.append({
        type: "approval_granted",
        taskId: task.id,
        actionId: approved.actionId,
        actor: input.approvedBy,
        risk: approved.risk,
        payloadHash: hash,
        toolName: approved.toolName,
        arguments: approved.arguments,
      });
      input.audit.append({
        type: "action_enqueued",
        taskId: task.id,
        sessionId: approved.sessionId,
        actionId: approved.actionId,
        toolName: approved.toolName,
        actor: approved.actor,
        risk: approved.risk,
        arguments: approved.arguments,
      });
    }
    task.enqueuedActionIds = enqueued;
    task.mutationActionIds = [...(task.mutationActionIds ?? []), ...mutationIds];
    task.state = "running";
    task.updatedAt = new Date().toISOString();
    input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    return this.publicTask(task);
  }

  rejectTask(taskId: string, input: { rejectedBy: string; audit: AuditLog; reason?: string }) {
    const task = this.tasks.get(taskId);
    if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
    if (task.state !== "awaiting_approval" && task.state !== "planned") {
      throw Object.assign(new Error(`Task cannot be rejected in state ${task.state}`), {
        code: "INVALID_STATE",
        status: 409,
      });
    }
    task.state = "rejected";
    task.error = input.reason ?? "Rejected by user";
    task.updatedAt = new Date().toISOString();
    input.audit.append({
      type: "approval_rejected",
      taskId: task.id,
      actor: input.rejectedBy,
      reason: task.error,
    });
    input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    return this.publicTask(task);
  }

  cancelTask(
    taskId: string,
    input: { cancelledBy: string; sessions: SessionStore; audit: AuditLog },
  ) {
    const task = this.tasks.get(taskId);
    if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
    if (task.state === "completed" || task.state === "rejected" || task.state === "cancelled") {
      throw Object.assign(new Error(`Task already terminal (${task.state})`), {
        code: "INVALID_STATE",
        status: 409,
      });
    }
    const sessionId = task.bdsSessionId ?? input.sessions.listSessions()[0]?.sessionId;
    for (const actionId of task.enqueuedActionIds ?? []) {
      if (!sessionId) break;
      const cancel = createActionRequest({
        sessionId,
        requestId: newId("req"),
        actionId: newId("action"),
        idempotencyKey: newId("idem"),
        toolName: "control.cancel",
        arguments: { actionId },
        actor: input.cancelledBy,
        permissionMode: task.permissionMode ?? "confirm_every_change",
        risk: "normal",
        noApprovalReason: "task_cancel",
      });
      input.sessions.enqueue(sessionId, cancel);
    }
    task.state = "cancelled";
    task.updatedAt = new Date().toISOString();
    input.audit.append({
      type: "task_cancelled",
      taskId: task.id,
      actor: input.cancelledBy,
      actionIds: task.enqueuedActionIds ?? [],
    });
    input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    return this.publicTask(task);
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
    for (const task of this.tasks.values()) {
      if (!task.enqueuedActionIds?.includes(actionId)) continue;
      const previous = this.operationEventQueues.get(task.id) ?? Promise.resolve();
      const current = previous
        .catch(() => undefined)
        .then(() => this.processOperationEvent(task, actionId, state, audit, detail));
      this.operationEventQueues.set(task.id, current);
      try {
        await current;
      } finally {
        if (this.operationEventQueues.get(task.id) === current) {
          this.operationEventQueues.delete(task.id);
        }
      }
      return;
    }
  }

  private async processOperationEvent(
    task: AgentTask,
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
    if (task.state === "cancelled" || task.state === "rejected") return;

    const inspectionWaiter = this.inspectionWaiters.get(actionId);
    const terminalInspection =
      state === "completed" ||
      state === "partially_completed" ||
      state === "failed" ||
      state === "cancelled";
    if (inspectionWaiter && terminalInspection) {
      clearTimeout(inspectionWaiter.timer);
      this.inspectionWaiters.delete(actionId);
      if (state === "completed" || state === "partially_completed") {
        inspectionWaiter.resolve({ message: detail?.message ?? state, result: detail?.result });
      } else {
        inspectionWaiter.reject(new Error(detail?.message ?? `Inspection ${state}`));
      }
    }

      const terminal =
        state === "completed" ||
        state === "partially_completed" ||
        state === "failed" ||
        state === "cancelled";

      if (state === "running") {
        if (task.state !== "inspecting" && task.state !== "verifying") {
          task.state = "running";
        }
      }

      if (terminal) {
        const completed = new Set(task.completedActionIds ?? []);
        // BDS may retry delivery. A terminal action must affect history/state exactly once.
        if (completed.has(actionId)) return;
        completed.add(actionId);
        task.completedActionIds = [...completed];

        if (detail?.message || detail?.result !== undefined) {
          const tool =
            detail.toolName ??
            task.actionToolNames?.[actionId] ??
            task.proposedActions?.find((a) => a.actionId === actionId)?.toolName ??
            "tool";
          const resultText =
            detail.result !== undefined
              ? `${detail.message ?? "ok"}\n${JSON.stringify(detail.result).slice(0, 1500)}`
              : (detail.message ?? "ok");
          this.appendHistory(task.piSessionId, {
            role: "assistant",
            content: `[tool result ${tool}] ${resultText}`.slice(0, 4000),
          });
          await injectPiToolResult(task.piSessionId, tool, detail.message ?? "ok", detail.result);
        }

        if (state === "failed") {
          task.state = "failed";
        } else if (state === "cancelled") {
          task.state = "cancelled";
        } else if (state === "partially_completed") {
          task.state = "partial";
        } else if (state === "completed") {
          const inspectIds = task.inspectActionIds ?? [];
          const mutationIds = task.mutationActionIds ?? [];
          const verifyIds = task.verifyActionIds ?? [];
          const done = (ids: string[]) =>
            ids.length > 0 && ids.every((id) => completed.has(id));

          if (task.awaitingInspectReplan && done(inspectIds) && detail?.sessions) {
            await this.replanAfterInspection(task.id, detail.sessions, audit);
          } else if (task.state === "inspecting" && done(inspectIds) && !task.awaitingInspectReplan) {
            task.state = "completed";
          } else if (
            (task.state === "running" || mutationIds.length > 0) &&
            mutationIds.length > 0 &&
            done(mutationIds)
          ) {
            if ((task.pendingVerification?.length ?? 0) > 0 && detail?.sessions) {
              this.enqueueVerification(task, detail.sessions, audit);
            } else if (verifyIds.length === 0) {
              task.state = "completed";
            }
          } else if (task.state === "verifying" && done(verifyIds)) {
            task.state = "completed";
          } else if (
            inspectIds.length > 0 &&
            done(inspectIds) &&
            mutationIds.length === 0 &&
            !task.awaitingInspectReplan &&
            task.state !== "awaiting_approval"
          ) {
            // Inspect-only task
            task.state = "completed";
          } else if (
            (task.enqueuedActionIds ?? []).every((id) => completed.has(id)) &&
            task.state !== "awaiting_approval" &&
            task.state !== "inspecting" &&
            task.state !== "verifying"
          ) {
            task.state = "completed";
          }
        }
      }

      task.updatedAt = new Date().toISOString();
      audit.append({
        type: "task_lifecycle",
        taskId: task.id,
        actionId,
        state: task.state,
        operationState: state,
      });
      return;
  }

  getTask(id: string) {
    const t = this.tasks.get(id);
    return t ? this.publicTask(t) : undefined;
  }

  /** Chat turns stored for this task's Pi session (for UI restore). */
  getTaskTranscript(id: string): ChatTurn[] {
    const t = this.tasks.get(id);
    if (!t) return [];
    return [...(this.chatHistory.get(t.piSessionId) ?? [])];
  }

  deleteTask(id: string) {
    if (!this.tasks.has(id)) throw new Error("Task not found");
    this.tasks.delete(id);
  }

  listTasks() {
    return [...this.tasks.values()].map((t) => this.publicTask(t));
  }

  private needProvider(id: string) {
    const p = this.profiles.get(id);
    if (!p) throw new Error("Unknown provider profile");
    return p;
  }

  private publicTask(t: AgentTask) {
    const clone = structuredClone(t);
    delete clone.pendingReads;
    delete clone.pendingVerification;
    delete clone.actionToolNames;
    return clone;
  }
}

/** HTTP Authorization headers must be Latin-1 / ByteString-safe. */
function sanitizeApiKey(raw: string): string {
  const key = raw.trim().replace(/^Bearer\s+/i, "");
  if (!key) throw new Error("API key is empty");
  if (/grammarly|iterable|not supported/i.test(key)) {
    throw new Error("That looks like a browser extension error, not an API key — paste the key again");
  }
  if (/[^\x20-\x7E]/.test(key)) {
    throw new Error("API key contains invalid characters — paste only the key text");
  }
  return key;
}
