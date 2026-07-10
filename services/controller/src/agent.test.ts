import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { newId } from "@intelacraft/shared-protocol";
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

  it("defers mutations until inspect completes (inspecting state)", () => {
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
    assert.equal(row.proposedActions?.length, 0);
    assert.equal(row.awaitingInspectReplan, true);
    (agent as any).enqueuePendingReads(row, sessions, audit);
    assert.equal(row.state, "inspecting");
    assert.equal(row.enqueuedActionIds?.length, 1);
    const polled = sessions.dequeue(sessionId);
    assert.equal(polled?.toolName, "inspect.players");
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
});
