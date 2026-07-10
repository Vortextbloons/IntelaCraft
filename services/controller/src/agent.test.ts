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

  it("keeps mutations in awaiting_approval while auto-running inspection", () => {
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

    assert.equal(row.state, "awaiting_approval");
    assert.equal(row.proposedActions?.length, 1);
    assert.equal(row.proposedActions[0].toolName, "world.fill_blocks");
    (agent as any).enqueuePendingReads(row, sessions, audit);
    assert.equal(row.state, "awaiting_approval");
    assert.equal(row.enqueuedActionIds?.length, 1);
    const polled = sessions.dequeue(sessionId);
    assert.equal(polled?.toolName, "inspect.players");
  });
});
