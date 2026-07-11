import {
  createActionRequest,
  newId,
  validateToolArguments,
  type ActionRequestMessage,
  type AiMode,
  type RiskClass,
  type ToolName,
} from "@intelacraft/shared-protocol";
import {
  generateSemantic,
  previewPlacements,
  validateBuildPlan,
  type SemanticToolName,
  type WorldSnapshot,
} from "@intelacraft/construction";
import type { AgentPlan } from "@intelacraft/pi-extension";
import { redactSecrets } from "@intelacraft/pi-extension";
import { classify } from "../../policy.js";
import type { SessionStore } from "../../store.js";
import type { AgentContext, AgentTask, PlanInput } from "../types.js";

export function buildWorldContext(ctx: AgentContext, sessions?: SessionStore, clientWorld?: unknown): unknown {
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
    adminCommandIds: Object.keys(ctx.config.adminCommands),
  });
}

export function materializeAction(
  ctx: AgentContext,
  step: { toolName: string; arguments: Record<string, unknown> },
  input: PlanInput,
  forceRead: boolean,
): ActionRequestMessage {
  const policy = {
    protectedRegions: ctx.config.protectedRegions,
    builderRegions: ctx.config.builderRegions,
    adminCommands: ctx.config.adminCommands,
  };
  let tool = step.toolName as ToolName;
  let args = step.arguments;
  if (step.toolName.startsWith("build.")) {
    const build = generateSemantic(step.toolName as SemanticToolName, args);
    tool = "world.place_blocks";
    args = { dimension: build.dimension, blocks: build.blocks, captureRollback: true };
  }
  if (tool === "admin.run_command") {
    const commandId = String(args.commandId ?? "");
    const entry = ctx.config.adminCommands[commandId];
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
    permissionMode: input.permissionMode ?? ctx.config.defaultPermissionMode,
    risk: forceRead || tool.startsWith("inspect.") ? "read" : "normal",
  });
  const c = classify(draft, policy);
  return {
    ...draft,
    risk: c.risk as RiskClass,
    noApprovalReason: c.risk === "read" ? "read_risk_no_approval" : undefined,
  };
}

export function validatePlanTools(ctx: AgentContext, plan: AgentPlan, mode: AiMode = "agent") {
  if (mode === "ask" && (plan.actions.length > 0 || plan.verification.length > 0)) {
    throw new Error("Ask mode is read-only: actions and verification must be empty");
  }
  for (const step of [...plan.inspection, ...plan.verification]) {
    if (!step.toolName.startsWith("inspect.")) {
      throw new Error("Inspection and verification steps must be read-only");
    }
  }
  const semantic = plan.actions.filter((step) => step.toolName.startsWith("build."));
  if (semantic.length) {
    const validation = validateBuildPlan({
      summary: plan.summary,
      palette: plan.build?.palette ?? [],
      steps: semantic.map((step, index) => ({
        id: step.id ?? `build-${index + 1}`,
        summary: step.summary,
        toolName: step.toolName as SemanticToolName,
        arguments: step.arguments,
        dependsOn: step.dependsOn,
      })),
      verification: plan.verification,
      estimates: plan.build?.estimates ?? { blocksChanged: 0, operations: semantic.length },
      warnings: plan.build?.warnings ?? [],
    }, { protectedRegions: ctx.config.protectedRegions as any });
    const errors = validation.issues.filter((issue) => issue.severity === "error");
    if (errors.length) throw new Error(errors.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
  }
}

export function applyPlanToTask(
  ctx: AgentContext,
  task: AgentTask,
  plan: AgentPlan,
  input: PlanInput,
) {
  validatePlanTools(ctx, plan, task.mode);
  for (const step of [...plan.inspection, ...plan.verification]) {
    const v = validateToolArguments(step.toolName as ToolName, step.arguments);
    if (!v.ok) throw new Error(`Invalid ${step.toolName}: ${v.error.message}`);
  }
  const reads = plan.inspection.map((step) => materializeAction(ctx, step, input, true));
  const proposed = plan.actions.map((a) => materializeAction(ctx, a, input, false));
  const generatedBuilds = plan.actions.filter((a) => a.toolName.startsWith("build.")).map((a) => generateSemantic(a.toolName as SemanticToolName, a.arguments));
  const detailed = generatedBuilds.flatMap((build) => build.blocks);
  // Semantic geometry must be checked against the live server immediately before approval.
  // The normal inspect/replan gate returns these observations to Pi for one correction pass.
  for (const build of generatedBuilds) {
    reads.push(materializeAction(ctx, { toolName: "inspect.build_collision", arguments: { dimension: build.dimension, region: build.bounds } }, input, true));
  }
  task.preview = detailed.length ? previewPlacements({ dimension: generatedBuilds[0].dimension, blocks: detailed, bounds: { min: { x: Math.min(...detailed.map(b=>b.position.x)), y: Math.min(...detailed.map(b=>b.position.y)), z: Math.min(...detailed.map(b=>b.position.z)) }, max: { x: Math.max(...detailed.map(b=>b.position.x)), y: Math.max(...detailed.map(b=>b.position.y)), z: Math.max(...detailed.map(b=>b.position.z)) } } }, { protectedRegions: ctx.config.protectedRegions as any, snapshot: task.worldSnapshot }) : undefined;
  if (plan.build && task.preview) {
    plan.build.estimates = { blocksChanged: task.preview.generatedBlocks, operations: proposed.length };
    plan.build.warnings = task.preview.warnings;
  }
  const verification = plan.verification.map((step) => materializeAction(ctx, step, input, true));
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
    // Inspect before exposing mutations for approval, but retain the immutable
    // actions generated for this plan. Re-asking the model to recreate them
    // after inspection can yield a chat-only response, which previously made
    // a build look completed without ever enqueuing its placements.
    task.awaitingInspectReplan = false;
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

export function applyAgentVerificationPlan(ctx: AgentContext, task: AgentTask, plan: AgentPlan) {
  if (plan.actions.length > 0) {
    // Corrective work is a new immutable proposal and must be approved again.
    applyPlanToTask(ctx, task, { ...plan, inspection: [] }, {
      bdsSessionId: task.bdsSessionId!,
      actor: task.actor,
      permissionMode: task.permissionMode,
    });
    return;
  }
  if (!(plan.evidence?.length)) {
    task.state = "partial";
    task.error = "Verification finished without observable evidence";
    return;
  }
  if (plan.outcome !== "complete") {
    task.state = "partial";
    task.error = plan.outcome === "blocked" ? plan.summary : "Agent did not explicitly confirm completion";
    return;
  }
  task.plan = { ...plan, inspection: [], verification: [] };
  task.proposedActions = [];
  task.pendingReads = [];
  task.pendingVerification = [];
  task.state = "completed";
}

export function updateWorldSnapshotFromCollision(
  ctx: AgentContext,
  task: AgentTask,
  result: unknown,
) {
  if (result && typeof result === "object") {
    const collisionResult = result as { dimension?: string; collisions?: Array<{ position?: { x:number;y:number;z:number }; type?: string }> };
    if (collisionResult.dimension && Array.isArray(collisionResult.collisions)) {
      task.worldSnapshot = { capturedAt: new Date().toISOString(), dimension: collisionResult.dimension as WorldSnapshot["dimension"], collisions: collisionResult.collisions.map((c) => ({ position: c.position, type: c.type ?? "unknown" })), protectedRegions: ctx.config.protectedRegions as any };
    }
  }
}
