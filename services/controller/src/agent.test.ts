import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { newId } from "@intelacraft/shared-protocol";
import { createPiSession } from "@intelacraft/pi-extension";
import { ActivityStore } from "./activity.js";
import { AgentRuntime } from "./agent.js";
import { AuditLog } from "./audit.js";
import type { ControllerConfig } from "./config.js";
import { SessionStore } from "./store.js";

const dir = mkdtempSync(join(tmpdir(), "intelacraft-agent-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function config(): ControllerConfig {
  return {
    port: 0,
    bdsToken: "t",
    auditPath: join(dir, "audit.jsonl"),
    auditRetentionDays: 30,
    heartbeatStaleMs: 15000,
    protectedRegions: [],
    builderRegions: [],
    piStoragePath: join(dir, "pi"),
    providersPath: join(dir, "providers.json"),
    adminCommands: {},
    webviewDistPath: join(dir, "missing"),
    defaultPermissionMode: "confirm_every_change",
  };
}

function openSession(sessions: SessionStore, sessionId: string) {
  sessions.upsertSession({
    sessionId,
    serverId: "test-server",
    connectedAt: new Date().toISOString(),
    lastHeartbeatAt: null,
    lastHealth: null,
    protocolVersion: "1.0",
  });
}

describe("AgentRuntime read-only inspect auto-run", () => {
  it("rejects a follow-up while the same Pi session still has active work", async () => {
    const agent = new AgentRuntime(config());
    const active = {
      id: newId("task"),
      piSessionId: "pi",
      request: "inspect the world",
      state: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: "ask",
    };
    (agent as any).tasks.set(active.id, active);

    await assert.rejects(
      () => agent.continueTask(active.id, { request: "send another message" }),
      (error: any) => error?.code === "AI_BUSY" && error?.status === 409,
    );
  });

  it("creates controller sessions in Ask mode by default", () => {
    const session = createPiSession(join(dir, "pi-session-mode"), {
      id: "test",
      name: "Test",
      baseUrl: "http://127.0.0.1:1",
      apiKey: "test-key",
      model: "test-model",
    });
    assert.equal(session.mode, "ask");
  });

  it("rejects mutation and verification steps in Ask mode", () => {
    const agent = new AgentRuntime(config());
    const mutation = {
      summary: "Build a platform",
      inspection: [],
      actions: [{ toolName: "world.fill_blocks", arguments: {}, summary: "fill" }],
      verification: [],
      notes: [],
    };
    const verification = {
      summary: "Check result",
      inspection: [],
      actions: [],
      verification: [{ toolName: "inspect.region", arguments: {}, summary: "verify" }],
      notes: [],
    };

    assert.throws(() => (agent as any).validatePlanTools(mutation, "ask"), /Ask mode is read-only/);
    assert.throws(() => (agent as any).validatePlanTools(verification, "ask"), /Ask mode is read-only/);
  });

  it("allows the same bounded proposal in Agent mode and queues it after approval", () => {
    const agent = new AgentRuntime(config());
    const sessions = new SessionStore();
    const activity = new ActivityStore(join(dir, "audit-agent-mode.jsonl"), 30);
    const audit = new AuditLog(join(dir, "audit-agent-mode.jsonl"), activity);
    const sessionId = newId("session");
    openSession(sessions, sessionId);
    const task: any = {
      id: newId("task"), piSessionId: "pi", request: "build a pad", mode: "agent", state: "planning",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), bdsSessionId: sessionId,
      actor: "pi-agent", permissionMode: "confirm_every_change",
    };
    (agent as any).tasks.set(task.id, task);
    (agent as any).applyPlanToTask(task, {
      summary: "Build a stone pad", inspection: [], verification: [], notes: [],
      actions: [{ toolName: "world.fill_blocks", summary: "Stone pad", arguments: {
        dimension: "minecraft:overworld", region: { min: { x: 0, y: 64, z: 0 }, max: { x: 1, y: 64, z: 1 } },
        blockType: "minecraft:stone", captureRollback: true,
      } }],
    }, { bdsSessionId: sessionId, actor: "pi-agent", permissionMode: "confirm_every_change" });

    assert.equal(task.state, "awaiting_approval");
    (agent as any).approveTask(task.id, { approvedBy: "tester", sessions, audit });
    assert.equal(task.state, "running");
    assert.equal(sessions.dequeue(sessionId)?.toolName, "world.fill_blocks");

    // A late/stale lifecycle update must not make the consumed proposal
    // approvable again.
    task.state = "awaiting_approval";
    assert.throws(
      () => (agent as any).approveTask(task.id, { approvedBy: "tester", sessions, audit }),
      (error: any) => error?.code === "INVALID_STATE" && error?.status === 409,
    );

    task.mode = "ask";
    assert.throws(() => (agent as any).applyPlanToTask(task, {
      summary: "Try another pad", inspection: [], verification: [], notes: [],
      actions: [{ toolName: "world.fill_blocks", summary: "blocked", arguments: {} }],
    }, { bdsSessionId: sessionId }), /Ask mode is read-only/);
  });

  it("preflights semantic builds before approval and materializes detailed placements", () => {
    const agent = new AgentRuntime(config()); const sessions = new SessionStore(); const activity = new ActivityStore(join(dir, "audit-semantic.jsonl"), 30); const audit = new AuditLog(join(dir, "audit-semantic.jsonl"), activity); const sessionId = newId("session"); openSession(sessions, sessionId);
    const row: any = { id:newId("task"),piSessionId:"pi",request:"build wall",state:"planning",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),bdsSessionId:sessionId,actor:"pi-agent",permissionMode:"confirm_every_change" }; (agent as any).tasks.set(row.id,row);
    (agent as any).applyPlanToTask(row,{summary:"Build wall",inspection:[],actions:[{id:"wall",toolName:"build.wall",arguments:{dimension:"minecraft:overworld",from:{x:0,y:64,z:0},to:{x:2,y:64,z:0},height:2,blockType:"minecraft:stone"},summary:"Wall"}],verification:[],notes:[]},{bdsSessionId:sessionId});
    assert.equal(row.state,"inspecting"); assert.equal(row.proposedActions.length,1); assert.equal(row.pendingReads.length,1); assert.equal(row.pendingReads[0].toolName,"inspect.build_collision"); assert.equal(row.preview.generatedBlocks,6);
    (agent as any).enqueuePendingReads(row,sessions,audit); assert.equal(sessions.dequeue(sessionId)?.toolName,"inspect.build_collision");
  });
  it("materializes inspect.players and enqueues without approval", () => {
    const agent = new AgentRuntime(config());
    const sessions = new SessionStore();
    const activity = new ActivityStore(join(dir, "audit-agent.jsonl"), 30);
    const audit = new AuditLog(join(dir, "audit-agent.jsonl"), activity);
    const sessionId = newId("session");
    openSession(sessions, sessionId);

    const row: any = {
      id: newId("task"),
      piSessionId: "pi",
      request: "who is online?",
      state: "planning",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bdsSessionId: sessionId,
      actor: "pi-agent",
      permissionMode: "confirm_every_change",
    };
    (agent as any).tasks.set(row.id, row);

    (agent as any).applyPlanToTask(
      row,
      {
        summary: "Checking online players.",
        inspection: [{ toolName: "inspect.players", arguments: {}, summary: "List players" }],
        actions: [],
        verification: [],
        notes: [],
      },
      { bdsSessionId: sessionId, actor: "pi-agent", permissionMode: "confirm_every_change" },
    );

    assert.equal(row.state, "planned");
    assert.equal(row.proposedActions?.length, 1);
    assert.equal(row.proposedActions[0].toolName, "inspect.players");
    assert.equal(row.proposedActions[0].risk, "read");
    assert.equal(row.pendingReads?.length, 1);

    (agent as any).enqueuePendingReads(row, sessions, audit);
    assert.equal(row.state, "running");
    assert.equal(row.pendingReads?.length, 0);
    assert.equal(row.enqueuedActionIds?.length, 1);
    const polled = sessions.dequeue(sessionId);
    assert.ok(polled);
    assert.equal(polled.toolName, "inspect.players");
    assert.equal(polled.noApprovalReason, "read_risk_no_approval");
    assert.equal(polled.approval, undefined);
  });

  it("defers mutations until inspect completes (inspecting state)", async () => {
    const agent = new AgentRuntime(config());
    const sessions = new SessionStore();
    const activity = new ActivityStore(join(dir, "audit-agent2.jsonl"), 30);
    const audit = new AuditLog(join(dir, "audit-agent2.jsonl"), activity);
    const sessionId = newId("session");
    openSession(sessions, sessionId);

    const row: any = {
      id: newId("task"),
      piSessionId: "pi",
      request: "build a platform",
      state: "planning",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bdsSessionId: sessionId,
      actor: "pi-agent",
      permissionMode: "confirm_every_change",
    };
    (agent as any).tasks.set(row.id, row);

    (agent as any).applyPlanToTask(
      row,
      {
        summary: "Inspect then fill.",
        inspection: [{ toolName: "inspect.players", arguments: {}, summary: "players" }],
        actions: [
          {
            toolName: "world.fill_blocks",
            arguments: {
              dimension: "minecraft:overworld",
              region: { min: { x: 0, y: 64, z: 0 }, max: { x: 1, y: 64, z: 1 } },
              blockType: "minecraft:stone",
            },
            summary: "stone pad",
          },
        ],
        verification: [],
        notes: [],
      },
      { bdsSessionId: sessionId },
    );

    assert.equal(row.state, "inspecting");
    assert.equal(row.proposedActions?.length, 1);
    assert.equal(row.awaitingInspectReplan, false);
    (agent as any).enqueuePendingReads(row, sessions, audit);
    assert.equal(row.state, "inspecting");
    assert.equal(row.enqueuedActionIds?.length, 1);
    const polled = sessions.dequeue(sessionId);
    assert.equal(polled?.toolName, "inspect.players");
    await agent.onOperationEvent(polled!.actionId, "completed", audit, {
      sessions,
    });
    assert.equal(row.state, "awaiting_approval");
    (agent as any).approveTask(row.id, { approvedBy: "tester", sessions, audit });
    assert.equal(sessions.dequeue(sessionId)?.toolName, "world.fill_blocks");
  });

  it("attributes results by action id and ignores duplicate terminal events", async () => {
    const agent = new AgentRuntime(config());
    const sessions = new SessionStore();
    const activity = new ActivityStore(join(dir, "audit-agent3.jsonl"), 30);
    const audit = new AuditLog(join(dir, "audit-agent3.jsonl"), activity);
    const sessionId = newId("session");
    openSession(sessions, sessionId);

    const row: any = {
      id: newId("task"),
      piSessionId: "pi-missing-is-ok",
      request: "check players and weather",
      state: "planning",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bdsSessionId: sessionId,
      actor: "pi-agent",
      permissionMode: "confirm_every_change",
    };
    (agent as any).tasks.set(row.id, row);
    (agent as any).applyPlanToTask(
      row,
      {
        summary: "Checking players and weather.",
        inspection: [
          { toolName: "inspect.players", arguments: {}, summary: "players" },
          { toolName: "inspect.world_state", arguments: {}, summary: "world state" },
        ],
        actions: [],
        verification: [],
        notes: [],
      },
      { bdsSessionId: sessionId },
    );
    (agent as any).enqueuePendingReads(row, sessions, audit);
    const first = sessions.dequeue(sessionId);
    const second = sessions.dequeue(sessionId);
    assert.ok(first && second);
    assert.equal(second.toolName, "inspect.world_state");

    await agent.onOperationEvent(second.actionId, "completed", audit, {
      message: "clear",
      result: { weather: "clear" },
      sessions,
    });
    await agent.onOperationEvent(second.actionId, "completed", audit, {
      message: "duplicate",
      result: { weather: "rain" },
      sessions,
    });

    const history = (agent as any).chatHistory.get(row.piSessionId);
    assert.equal(history.length, 1);
    assert.match(history[0].content, /\[tool result inspect\.world_state\]/);
    assert.doesNotMatch(history[0].content, /duplicate/);
  });

  it("returns a correlated Bedrock observation to an in-turn Pi inspection", async () => {
    const agent = new AgentRuntime(config());
    const sessions = new SessionStore();
    const activity = new ActivityStore(join(dir, "audit-agent4.jsonl"), 30);
    const audit = new AuditLog(join(dir, "audit-agent4.jsonl"), activity);
    const sessionId = newId("session");
    openSession(sessions, sessionId);
    const row: any = {
      id: newId("task"),
      piSessionId: "pi",
      request: "what is the weather?",
      state: "planning",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bdsSessionId: sessionId,
      actor: "pi-agent",
      permissionMode: "confirm_every_change",
      enqueuedActionIds: [],
      inspectActionIds: [],
      completedActionIds: [],
    };
    (agent as any).tasks.set(row.id, row);

    const observationPromise = (agent as any).executePiInspection(
      row,
      "inspect.world_state",
      {},
      sessions,
      audit,
    );
    const action = sessions.dequeue(sessionId);
    assert.ok(action);
    assert.equal(action.toolName, "inspect.world_state");
    assert.equal(action.risk, "read");

    await agent.onOperationEvent(action.actionId, "completed", audit, {
      message: "Weather inspected",
      result: { weather: "clear" },
      sessions,
    });
    assert.deepEqual(await observationPromise, {
      message: "Weather inspected",
      result: { weather: "clear" },
    });
  });

  it("schedules one agent verification turn after mutation completion", async () => {
    const agent = new AgentRuntime(config());
    const sessions = new SessionStore();
    const activity = new ActivityStore(join(dir, "audit-agent5.jsonl"), 30);
    const audit = new AuditLog(join(dir, "audit-agent5.jsonl"), activity);
    const sessionId = newId("session");
    const actionId = newId("action");
    openSession(sessions, sessionId);
    const row: any = {
      id: newId("task"),
      piSessionId: "pi",
      request: "build a platform",
      state: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bdsSessionId: sessionId,
      actor: "pi-agent",
      permissionMode: "confirm_every_change",
      enqueuedActionIds: [actionId],
      mutationActionIds: [actionId],
      completedActionIds: [],
      pendingVerification: [],
      agentVerificationStarted: false,
    };
    (agent as any).tasks.set(row.id, row);
    let verificationCalls = 0;
    (agent as any).verifyAfterMutations = async () => {
      verificationCalls += 1;
    };

    await agent.onOperationEvent(actionId, "completed", audit, {
      message: "fill complete",
      result: { changedBlocks: 9 },
      sessions,
    });
    await agent.onOperationEvent(actionId, "completed", audit, {
      message: "duplicate",
      sessions,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(row.state, "verifying");
    assert.equal(row.agentVerificationStarted, true);
    assert.equal(verificationCalls, 1);
  });

  it("requires fresh approval for an agent-proposed corrective mutation", () => {
    const agent = new AgentRuntime(config());
    const task: any = {
      id: newId("task"),
      piSessionId: "pi",
      request: "build a platform",
      state: "verifying",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bdsSessionId: newId("session"),
      actor: "pi-agent",
      permissionMode: "confirm_every_change",
    };
    (agent as any).applyAgentVerificationPlan(task, {
      summary: "One corner is missing; proposing a bounded repair.",
      inspection: [],
      actions: [
        {
          toolName: "world.fill_blocks",
          arguments: {
            dimension: "minecraft:overworld",
            region: { min: { x: 1, y: 64, z: 1 }, max: { x: 1, y: 64, z: 1 } },
            blockType: "minecraft:stone",
            captureRollback: true,
          },
          summary: "Repair missing corner",
        },
      ],
      verification: [],
      notes: [],
    });

    assert.equal(task.state, "awaiting_approval");
    assert.equal(task.proposedActions.length, 1);
    assert.equal(task.proposedActions[0].toolName, "world.fill_blocks");
    assert.equal(task.proposedActions[0].approval, undefined);
  });

  it("reuses identical inspections and caps unique calls per planning turn", async () => {
    const agent = new AgentRuntime(config());
    const task: any = { metrics: {} };
    const cache = new Map();
    let executions = 0;
    const bounded = (agent as any).createBoundedInspectionExecutor(
      task,
      cache,
      async (toolName: string, arguments_: Record<string, unknown>) => {
        executions += 1;
        return { message: "ok", result: { toolName, arguments_ } };
      },
    );

    const first = await bounded("inspect.player", { name: "Steve", detail: { b: 2, a: 1 } });
    const repeated = await bounded("inspect.player", { detail: { a: 1, b: 2 }, name: "Steve" });
    assert.deepEqual(repeated, first);
    assert.equal(executions, 1);
    assert.equal(task.metrics.inspectionToolCalls, 1);
    assert.equal(task.metrics.inspectionCacheHits, 1);

    for (let i = 0; i < 15; i++) await bounded("inspect.block", { position: { x: i, y: 64, z: 0 } });
    const exhausted = await bounded("inspect.block", { position: { x: 99, y: 64, z: 0 } });
    assert.match(exhausted.message, /Inspection budget exhausted/);
    assert.deepEqual(exhausted.result, { inspectionBudgetExhausted: true, maxUniqueCalls: 16 });
    assert.equal(executions, 16);
  });
});
