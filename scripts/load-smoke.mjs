#!/usr/bin/env node
/**
 * Concurrent poll/enqueue smoke load against a running controller.
 * Usage: node scripts/load-smoke.mjs
 */
import { createHandshake, createPoll, newId } from "@intelacraft/shared-protocol";

const base = process.env.INTELACRAFT_CONTROLLER_URL ?? "http://127.0.0.1:8787";
const token = process.env.INTELACRAFT_BDS_TOKEN ?? "dev-change-me";
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? "20");
const rounds = Number(process.env.LOAD_ROUNDS ?? "5");

async function api(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const hs = await api(
  "/v1/bds/handshake",
  createHandshake({
    sessionId: "pending",
    requestId: newId("req"),
    serverId: `load-${Date.now()}`,
  }),
);
if (hs.status !== 200) {
  console.error("Handshake failed", hs);
  process.exit(1);
}
const sessionId = hs.json.sessionId;
const started = Date.now();
let ok = 0;
let fail = 0;

for (let r = 0; r < rounds; r++) {
  const jobs = Array.from({ length: concurrency }, async (_, i) => {
    const enq = await api("/v1/actions", {
      sessionId,
      toolName: "inspect.server_status",
      arguments: {},
      actor: `load-${i}`,
      idempotencyKey: newId("idem"),
    });
    if (enq.status !== 202) {
      fail += 1;
      return;
    }
    const poll = await api(
      "/v1/bds/poll",
      createPoll({ sessionId, requestId: newId("req") }),
    );
    if (poll.status === 200) ok += 1;
    else fail += 1;
  });
  await Promise.all(jobs);
}

const ms = Date.now() - started;
console.log(
  JSON.stringify(
    { ok, fail, concurrency, rounds, elapsedMs: ms, opsPerSec: ((ok + fail) / (ms / 1000)).toFixed(1) },
    null,
    2,
  ),
);
process.exit(fail ? 1 : 0);
