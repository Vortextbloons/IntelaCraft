import { resolve } from "node:path";
import {
  createActionRequest,
  newId,
  redactSecrets,
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
  planRequest,
  publicProfile,
  testProvider,
  type AgentPlan,
  type PiSession,
  type ProviderProfile,
} from "@intelacraft/pi-extension";
import { AdvisoryMcpClient } from "@intelacraft/mcp-connection";
import type { ControllerConfig } from "./config.js";
import { classify, payloadHash } from "./policy.js";
import type { SessionStore } from "./store.js";
import type { AuditLog } from "./audit.js";

export type AgentTaskState =
  | "submitted"
  | "planning"
  | "awaiting_approval"
  | "planned"
  | "running"
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
  proposedActions?: ActionRequestMessage[];
  enqueuedActionIds?: string[];
  error?: string;
  bdsSessionId?: string;
  actor?: string;
  permissionMode?: PermissionMode;
}

export class AgentRuntime {
  private profiles = new Map<string, ProviderProfile>();
  private pi = new Map<string, PiSession>();
  private tasks = new Map<string, AgentTask>();
  readonly mcp: AdvisoryMcpClient;

  constructor(private config: ControllerConfig) {
    this.mcp = new AdvisoryMcpClient(config.mcpUrl, config.mcpToken);
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

  saveProvider(p: ProviderProfile) {
    if (!p.id || !p.baseUrl || !p.apiKey || !p.model) {
      throw new Error("Provider id, baseUrl, apiKey, and model are required");
    }
    this.profiles.set(p.id, { ...p });
    return publicProfile(p);
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
    await initializePiSession(s);
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
  }) {
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
    };
    this.tasks.set(task.id, task);
    task.state = "planning";
    try {
      const advice = input.useMcp ? await this.mcp.query(input.request) : undefined;
      const plan = await planRequest(
        this.needProvider(s.providerId),
        input.request,
        redactSecrets(input.worldContext ?? {}),
        redactSecrets(advice),
      );
      for (const step of [...plan.inspection, ...plan.verification]) {
        if (!step.toolName.startsWith("inspect.")) {
          throw new Error("Inspection and verification steps must be read-only");
        }
        const v = validateToolArguments(step.toolName as ToolName, step.arguments);
        if (!v.ok) throw new Error(`Invalid ${step.toolName}: ${v.error.message}`);
      }
      const policy = {
        protectedRegions: this.config.protectedRegions,
        builderRegions: this.config.builderRegions,
        adminCommands: this.config.adminCommands,
      };
      const proposed = plan.actions.map((a) => {
        const tool = a.toolName as ToolName;
        let args = a.arguments;
        if (tool === "admin.run_command") {
          const commandId = String(args.commandId ?? "");
          const entry = this.config.adminCommands[commandId];
          if (!entry) throw new Error(`Unknown admin commandId '${commandId}'`);
          args = { commandId, command: entry.command };
        }
        const valid = validateToolArguments(tool, args);
        if (!valid.ok) throw new Error(`Invalid model tool ${a.toolName}: ${valid.error.message}`);
        const draft = createActionRequest({
          sessionId: input.bdsSessionId,
          requestId: newId("req"),
          actionId: newId("action"),
          idempotencyKey: newId("idem"),
          toolName: tool,
          arguments: valid.value,
          actor: input.actor ?? "pi-agent",
          permissionMode: input.permissionMode ?? this.config.defaultPermissionMode,
          risk: tool.startsWith("inspect.") ? "read" : "normal",
        });
        const c = classify(draft, policy);
        return {
          ...draft,
          risk: c.risk as RiskClass,
          noApprovalReason: c.risk === "read" ? "read_risk_no_approval" : undefined,
        };
      });
      task.plan = plan;
      task.proposedActions = proposed;
      task.state = proposed.some((a) => a.risk !== "read") ? "awaiting_approval" : "planned";
    } catch (e) {
      task.state = "failed";
      task.error = e instanceof Error ? e.message : "Planning failed";
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
    const enqueued: string[] = [];
    const policy = {
      protectedRegions: this.config.protectedRegions,
      builderRegions: this.config.builderRegions,
      adminCommands: this.config.adminCommands,
    };
    for (const action of actions) {
      if (action.risk === "read") {
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

  onOperationEvent(actionId: string, state: string, audit: AuditLog) {
    for (const task of this.tasks.values()) {
      if (!task.enqueuedActionIds?.includes(actionId)) continue;
      if (task.state === "cancelled" || task.state === "rejected") return;
      if (state === "running") {
        task.state = "running";
      } else if (state === "completed") {
        const allDone = (task.enqueuedActionIds ?? []).every((id) => id === actionId) ||
          task.enqueuedActionIds!.length === 1;
        // Mark completed when any terminal success arrives for single-action; multi-action stays running until all known
        if (allDone || task.enqueuedActionIds!.length <= 1) task.state = "completed";
        else task.state = "running";
      } else if (state === "partially_completed") {
        task.state = "partial";
      } else if (state === "failed") {
        task.state = "failed";
      } else if (state === "cancelled") {
        task.state = "cancelled";
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
  }

  getTask(id: string) {
    const t = this.tasks.get(id);
    return t ? this.publicTask(t) : undefined;
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
    return structuredClone(t);
  }
}
