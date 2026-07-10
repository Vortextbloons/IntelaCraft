/**
 * Lightweight e2e: mock BDS poll loop + controller approve path (no real BDS).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  createHandshake,
  createOperationEvent,
  createPoll,
  newId,
} from "@intelacraft/shared-protocol";
import { ActivityStore } from "./activity.js";
import { AgentRuntime } from "./agent.js";
import { AuditLog } from "./audit.js";
import { createApp } from "./app.js";
import { EventStore, SessionStore, SettingsStore } from "./store.js";

const token = "e2e-token";
const dir = mkdtempSync(join(tmpdir(), "intelacraft-e2e-"));
const auditPath = join(dir, "audit.jsonl");
const activity = new ActivityStore(auditPath, 30);

const ctx = {
  config: {
    port: 0,
    bdsToken: token,
    auditPath,
    auditRetentionDays: 30,
    heartbeatStaleMs: 15000,
    protectedRegions: [],
    builderRegions: [],
    piStoragePath: join(dir, "pi"),
    providersPath: join(dir, "providers.json"),
    adminCommands: {},
    webviewDistPath: join(dir, "wv"),
    defaultPermissionMode: "confirm_every_change" as const,
  },
  sessions: new SessionStore(),
  events: new EventStore(),
  audit: new AuditLog(auditPath, activity),
  activity,
  settings: new SettingsStore("confirm_every_change"),
  agent: undefined as AgentRuntime | undefined,
};
ctx.agent = new AgentRuntime(ctx.config);

const server = createApp(ctx);
await new Promise<void>((r) => server.listen(0, r));
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  return { status: res.status, json: await res.json() };
}

describe("e2e mock BDS approve path", () => {
  it("handshakes, enqueues fill with approval, polls, and reports completion", async () => {
    const hs = await api("/v1/bds/handshake", {
      method: "POST",
      body: JSON.stringify(
        createHandshake({
          sessionId: "pending",
          requestId: newId("req"),
          serverId: "mock-bds",
        }),
      ),
    });
    assert.equal(hs.status, 200);
    const sessionId = hs.json.sessionId as string;

    const draft = await api("/v1/actions", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        toolName: "world.fill_blocks",
        arguments: {
          dimension: "minecraft:overworld",
          region: { min: { x: 0, y: 70, z: 0 }, max: { x: 2, y: 70, z: 2 } },
          blockType: "minecraft:oak_planks",
          captureRollback: true,
        },
        actor: "e2e",
      }),
    });
    assert.equal(draft.status, 409);
    const action = draft.json.approval.action;
    const approved = await api("/v1/actions", {
      method: "POST",
      body: JSON.stringify({
        ...action,
        approval: {
          approvalId: newId("approval"),
          approvedAt: new Date().toISOString(),
          approvedBy: "e2e",
          payloadHash: draft.json.approval.payloadHash,
        },
        noApprovalReason: undefined,
      }),
    });
    assert.equal(approved.status, 202);

    const poll = await api("/v1/bds/poll", {
      method: "POST",
      body: JSON.stringify(createPoll({ sessionId, requestId: newId("req") })),
    });
    assert.equal(poll.status, 200);
    assert.equal(poll.json.action.toolName, "world.fill_blocks");

    const done = await api("/v1/bds/events", {
      method: "POST",
      body: JSON.stringify(
        createOperationEvent({
          sessionId,
          requestId: newId("req"),
          operationId: newId("op"),
          actionId: approved.json.actionId,
          state: "completed",
          completedWork: 9,
          totalEstimatedWork: 9,
          message: "mock fill done",
          result: { rollback: { available: true, capturedBlocks: 9 } },
        }),
      ),
    });
    assert.equal(done.status, 200);

    const activityRes = await api("/v1/activity?type=approval_granted");
    assert.ok(activityRes.json.records.some((r: any) => r.type === "approval_granted"));
  });
});
