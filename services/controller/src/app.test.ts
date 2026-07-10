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
  createOperationEvent,
  createPoll,
  newId,
} from "@intelacraft/shared-protocol";
import { AuditLog } from "./audit.js";
import { createApp } from "./app.js";
import { EventStore, SessionStore } from "./store.js";

const token = "test-token";
const dir = mkdtempSync(join(tmpdir(), "intelacraft-audit-"));
const auditPath = join(dir, "audit.jsonl");

const ctx = {
  config: {
    port: 0,
    bdsToken: token,
    auditPath,
    heartbeatStaleMs: 15000,
  },
  sessions: new SessionStore(),
  events: new EventStore(),
  audit: new AuditLog(auditPath),
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

    const audit = readFileSync(auditPath, "utf8");
    assert.match(audit, /handshake/);
    assert.match(audit, /action_enqueued/);
    assert.match(audit, /operation_event/);
  });

  it("rejects duplicate idempotency keys", async () => {
    const session = ctx.sessions.listSessions()[0];
    assert.ok(session);
    const action = createActionRequest({
      sessionId: session.sessionId,
      requestId: newId("req"),
      actionId: newId("action"),
      idempotencyKey: "dup-key-1",
      toolName: "inspect.time",
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

// Keep createServer import used for typecheck in some tooling
void createServer;
