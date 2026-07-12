import { newId } from "@intelacraft/shared-protocol";
import type { AuditLog } from "../../audit.js";
import type { SessionStore } from "../../store.js";
import { payloadHash } from "../../policy.js";
import { publicTask } from "../task-store.js";
import type { AgentContext } from "../types.js";

export function enqueueNextCompiledPhase(ctx:AgentContext,task:NonNullable<ReturnType<AgentContext["tasks"]["get"]>>,sessions:SessionStore,audit:AuditLog):boolean{
 const compiled=task.pendingCompiledBuild;if(!compiled||!task.compiledActionPhases||!task.compiledApprovedBy)return false;let cursor=(task.compiledPhaseCursor??-1)+1;while(cursor<compiled.phases.length&&!compiled.phases[cursor].operations.length)cursor++;if(cursor>=compiled.phases.length){task.compiledPhaseCursor=cursor;return false;}const phase=compiled.phases[cursor],actions=(task.proposedActions??[]).filter(a=>task.compiledActionPhases?.[a.actionId]===phase.id),enqueued=[...(task.enqueuedActionIds??[])],mutations=[...(task.mutationActionIds??[])];for(const action of actions){const hash=payloadHash(action),approved={...action,approval:{approvalId:newId("approval"),approvedAt:new Date().toISOString(),approvedBy:task.compiledApprovedBy,payloadHash:hash},noApprovalReason:undefined};if(sessions.isEmergencyDisabled(approved.sessionId))throw Object.assign(new Error("Mutations are disabled"),{code:"EMERGENCY_DISABLED",status:503});const result=sessions.enqueue(approved.sessionId,approved);if(!result.ok)throw Object.assign(new Error(result.message),{code:result.code,status:409});enqueued.push(approved.actionId);mutations.push(approved.actionId);audit.append({type:"approval_granted",taskId:task.id,actionId:approved.actionId,actor:task.compiledApprovedBy,risk:approved.risk,payloadHash:hash,toolName:approved.toolName,arguments:approved.arguments});audit.append({type:"action_enqueued",taskId:task.id,sessionId:approved.sessionId,actionId:approved.actionId,toolName:approved.toolName,actor:approved.actor,risk:approved.risk,arguments:approved.arguments,phase:phase.id});}task.enqueuedActionIds=enqueued;task.mutationActionIds=mutations;task.compiledPhaseCursor=cursor;audit.append({type:"task_lifecycle",taskId:task.id,state:"running",phase:phase.id});return true;
}

export function approveTask(
  ctx: AgentContext,
  taskId: string,
  input: { approvedBy: string; sessions: SessionStore; audit: AuditLog },
) {
  const task = ctx.tasks.get(taskId);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "NOT_FOUND", status: 404 });
  if (task.state !== "awaiting_approval" && task.state !== "planned") {
    throw Object.assign(new Error(`Task cannot be approved in state ${task.state}`), {
      code: "INVALID_STATE",
      status: 409,
    });
  }
  const actions = task.proposedActions ?? [];
  const enqueued = new Set(task.enqueuedActionIds ?? []);
  const pendingMutations = actions.filter(
    (action) => action.risk !== "read" && !enqueued.has(action.actionId),
  );
  if (pendingMutations.length === 0 && actions.some((action) => action.risk !== "read")) {
    throw Object.assign(new Error("Task approval has already been consumed"), {
      code: "INVALID_STATE",
      status: 409,
    });
  }
  if (actions.length === 0) {
    task.state = "completed";
    task.updatedAt = new Date().toISOString();
    input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
    return publicTask(task);
  }
  if(task.compiledActionPhases){task.compiledApprovedBy=input.approvedBy;task.enqueuedActionIds=[];task.mutationActionIds=[];task.agentVerificationStarted=false;task.state="running";enqueueNextCompiledPhase(ctx,task,input.sessions,input.audit);task.updatedAt=new Date().toISOString();return publicTask(task);}
  const enqueuedActionIds: string[] = [...enqueued];
  const mutationIds: string[] = [];
  for (const action of actions) {
    if (action.risk === "read") {
      // Already auto-enqueued via enqueuePendingReads — skip duplicates.
      if (enqueuedActionIds.includes(action.actionId)) continue;
      const result = input.sessions.enqueue(action.sessionId, {
        ...action,
        noApprovalReason: "read_risk_no_approval",
      });
      if (!result.ok) {
        throw Object.assign(new Error(result.message), { code: result.code, status: 409 });
      }
      enqueuedActionIds.push(action.actionId);
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
    const approved = {
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
    enqueuedActionIds.push(approved.actionId);
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
  task.enqueuedActionIds = enqueuedActionIds;
  task.mutationActionIds = [...(task.mutationActionIds ?? []), ...mutationIds];
  task.agentVerificationStarted = false;
  task.state = "running";
  task.updatedAt = new Date().toISOString();
  input.audit.append({ type: "task_lifecycle", taskId: task.id, state: task.state });
  return publicTask(task);
}
