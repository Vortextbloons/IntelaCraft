import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  PROTOCOL_VERSION,
  createActionRequest,
  createHandshake,
  createHeartbeat,
  createCatalogSnapshot,
  createOperationEvent,
  createPoll,
  newId,
} from "@intelacraft/shared-protocol";
import { ActivityStore } from "./activity.js";
import { AuditLog } from "./audit.js";
import { createApp } from "./app.js";
import { EventStore, SessionStore, SettingsStore } from "./store.js";
import { CatalogService } from "./catalog.js";

const token = "test-token";
const dir = mkdtempSync(join(tmpdir(), "intelacraft-audit-"));
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
    adminCommands: {
      time_day: { command: "time set day", risk: "normal" as const, label: "Day" },
      stop_server: { command: "stop", risk: "strong" as const, label: "Stop" },
    },
    webviewDistPath: join(dir, "missing-webview"),
    defaultPermissionMode: "confirm_every_change" as const,
  },
  sessions: new SessionStore(),
  events: new EventStore(),
  audit: new AuditLog(auditPath, activity),
  activity,
  settings: new SettingsStore("confirm_every_change"),
  catalog: new CatalogService(),
};

const server = createApp(ctx);
await new Promise<void>((resolve) => server.listen(0, resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<{ status: number; json: any }> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.auth !== false) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const json = await res.json();
  return { status: res.status, json };
}

describe("controller auth", () => {
  it("rejects missing token", async () => {
    const res = await api("/v1/bds/handshake", {
      method: "POST",
      auth: false,
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });
});

describe("controller handshake and poll", () => {
  it("handshakes, enqueues, and polls an action", async () => {
    const handshake = createHandshake({
      sessionId: "pending",
      requestId: newId("req"),
      serverId: "bds-test",
    });
    const hs = await api("/v1/bds/handshake", {
      method: "POST",
      body: JSON.stringify(handshake),
    });
    assert.equal(hs.status, 200);
    assert.equal(hs.json.ok, true);
    assert.equal(hs.json.acceptedProtocolVersion, PROTOCOL_VERSION);
    const sessionId = hs.json.sessionId as string;
    const catalog = await api("/v1/bds/catalog", {
      method: "POST",
      body: JSON.stringify(createCatalogSnapshot({ sessionId, requestId: newId("req"), snapshot: { revision: 1, generatedAt: new Date().toISOString(), serverId: "bds-test", blocks: ["minecraft:stone", "my_pack:custom_block"], items: ["minecraft:stick"], entities: ["minecraft:zombie"] } })),
    });
    assert.equal(catalog.status, 200);

    const search = await api("/v1/catalog/search", { method: "POST", body: JSON.stringify({ sessionId, kind: "block", query: "custom block" }) });
    assert.equal(search.status, 200);
    assert.equal(search.json.matches[0].id, "my_pack:custom_block");

    const enqueue = await api("/v1/actions", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        toolName: "inspect.players",
        arguments: {},
        actor: "tester",
      }),
    });
    assert.equal(enqueue.status, 202);

    const poll = await api("/v1/bds/poll", {
      method: "POST",
      body: JSON.stringify(createPoll({ sessionId, requestId: newId("req") })),
    });
    assert.equal(poll.status, 200);
    assert.equal(poll.json.action.toolName, "inspect.players");

    const empty = await api("/v1/bds/poll", {
      method: "POST",
      body: JSON.stringify(createPoll({ sessionId, requestId: newId("req") })),
    });
    assert.equal(empty.json.action, null);

    const hb = await api("/v1/bds/heartbeat", {
      method: "POST",
      body: JSON.stringify(
        createHeartbeat({
          sessionId,
          requestId: newId("req"),
          serverId: "bds-test",
          health: { ok: true, playerCount: 0 },
        }),
      ),
    });
    assert.equal(hb.status, 200);

    const event = createOperationEvent({
      sessionId,
      requestId: newId("req"),
      operationId: newId("op"),
      actionId: enqueue.json.actionId,
      state: "completed",
      completedWork: 1,
      totalEstimatedWork: 1,
      message: "ok",
      result: { players: [] },
    });
    const ev = await api("/v1/bds/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
    assert.equal(ev.status, 200);

    const health = await api("/v1/health", { method: "GET", auth: false });
    assert.equal(health.status, 200);
    assert.equal(health.json.bdsConnected, true);
    assert.equal(health.json.catalog.available, true);

    const audit = readFileSync(auditPath, "utf8");
    assert.match(audit, /handshake/);
    assert.match(audit, /action_enqueued/);
    assert.match(audit, /operation_event/);
    assert.match(audit, /catalog_sync/);
  });

  it("rejects duplicate idempotency keys", async () => {
    const session = ctx.sessions.listSessions()[0];
    assert.ok(session);
    const action = createActionRequest({
      sessionId: session.sessionId,
      requestId: newId("req"),
      actionId: newId("action"),
      idempotencyKey: "dup-key-1",
      toolName: "inspect.world_state",
      arguments: {},
      actor: "tester",
    });
    const first = await api("/v1/actions", {
      method: "POST",
      body: JSON.stringify(action),
    });
    assert.equal(first.status, 202);
    const second = await api("/v1/actions", {
      method: "POST",
      body: JSON.stringify({
        ...action,
        actionId: newId("action"),
        requestId: newId("req"),
      }),
    });
    assert.equal(second.status, 409);
    assert.equal(second.json.error.code, "DUPLICATE");
  });
});

describe("phase 2 policy", () => {
  it("requires exact approval for a mutation", async () => {
    const s = ctx.sessions.listSessions()[0]!;
    const a = createActionRequest({
      sessionId: s.sessionId,
      requestId: newId(),
      actionId: newId(),
      idempotencyKey: newId(),
      toolName: "world.fill_blocks",
      arguments: {
        dimension: "minecraft:overworld",
        region: { min: { x: 0, y: 64, z: 0 }, max: { x: 1, y: 64, z: 1 } },
        blockType: "minecraft:stone",
      },
      actor: "tester",
      risk: "normal",
    });
    const r = await api("/v1/actions", { method: "POST", body: JSON.stringify(a) });
    assert.equal(r.status, 409);
    const approved = {
      ...a,
      approval: {
        approvalId: newId(),
        approvedAt: new Date().toISOString(),
        approvedBy: "tester",
        payloadHash: r.json.approval.payloadHash,
      },
      noApprovalReason: undefined,
    };
    assert.equal(
      (await api("/v1/actions", { method: "POST", body: JSON.stringify(approved) })).status,
      202,
    );
  });

  it("denies observe-only mutations", async () => {
    const s = ctx.sessions.listSessions()[0]!;
    const a = createActionRequest({
      sessionId: s.sessionId,
      requestId: newId(),
      actionId: newId(),
      idempotencyKey: newId(),
      toolName: "world.fill_blocks",
      arguments: {
        dimension: "minecraft:overworld",
        region: { min: { x: 0, y: 64, z: 0 }, max: { x: 0, y: 64, z: 0 } },
        blockType: "minecraft:stone",
      },
      actor: "tester",
      risk: "normal",
      permissionMode: "observe_only",
    });
    assert.equal(
      (await api("/v1/actions", { method: "POST", body: JSON.stringify(a) })).status,
      403,
    );
  });
});

describe("phase 4 activity and admin", () => {
  it("queries activity records", async () => {
    const res = await api("/v1/activity?limit=20");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.records));
    assert.ok(res.json.records.length > 0);
  });

  it("rejects unknown admin commandId", async () => {
    const s = ctx.sessions.listSessions()[0]!;
    const r = await api("/v1/actions", {
      method: "POST",
      body: JSON.stringify({
        sessionId: s.sessionId,
        toolName: "admin.run_command",
        arguments: { commandId: "not_real" },
        actor: "tester",
        risk: "normal",
      }),
    });
    assert.ok(r.status === 400 || r.status === 403);
  });

  it("requires approval for allowlisted admin command", async () => {
    const s = ctx.sessions.listSessions()[0]!;
    const r = await api("/v1/actions", {
      method: "POST",
      body: JSON.stringify({
        sessionId: s.sessionId,
        toolName: "admin.run_command",
        arguments: { commandId: "time_day" },
        actor: "tester",
      }),
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "APPROVAL_REQUIRED");
    assert.equal(r.json.approval.action.arguments.command, "time set day");
  });

  it("patches permission mode settings", async () => {
    const r = await api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ permissionMode: "observe_only" }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.permissionMode, "observe_only");
    await api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ permissionMode: "confirm_every_change" }),
    });
  });

  it("accepts all valid thinking levels including xhigh and max", async () => {
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      const r = await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ thinkingLevel: level }),
      });
      assert.equal(r.status, 200, `Expected 200 for thinkingLevel=${level}`);
      assert.equal(r.json.preferredThinkingLevel, level);
    }
  });

  it("rejects invalid thinking levels", async () => {
    const r = await api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ thinkingLevel: "invalid" }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "BAD_REQUEST");
  });

  it("returns preferredThinkingLevel in settings response", async () => {
    await api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({ thinkingLevel: "high" }),
    });
    const r = await api("/v1/settings");
    assert.equal(r.status, 200);
    assert.equal(r.json.preferredThinkingLevel, "high");
    assert.ok(r.json.thinkingLevel);
  });
});

void createServer;
