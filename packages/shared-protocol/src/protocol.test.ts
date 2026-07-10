import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROTOCOL_VERSION,
  createActionRequest,
  createHandshake,
  createIdempotencyTracker,
  isProtocolCompatible,
  normalizeRegion,
  parseProtocolVersion,
  redactSecrets,
  regionVolume,
  validateActionRequest,
  validateEnvelope,
  validateHandshake,
  validateToolArguments,
} from "./index.js";

describe("protocol version", () => {
  it("parses semver", () => {
    assert.deepEqual(parseProtocolVersion("1.0.0"), { major: 1, minor: 0, patch: 0 });
    assert.equal(parseProtocolVersion("1.0"), null);
    assert.equal(parseProtocolVersion("nope"), null);
  });

  it("fails closed on incompatible major", () => {
    assert.equal(isProtocolCompatible("1.9.9"), true);
    assert.equal(isProtocolCompatible("2.0.0"), false);
    assert.equal(isProtocolCompatible("0.1.0"), false);
    assert.equal(isProtocolCompatible("bad"), false);
  });
});

describe("region helpers", () => {
  it("normalizes inclusive min/max", () => {
    const region = normalizeRegion({ x: 5, y: 10, z: -3 }, { x: 1, y: 2, z: 4 });
    assert.deepEqual(region, {
      min: { x: 1, y: 2, z: -3 },
      max: { x: 5, y: 10, z: 4 },
    });
    assert.equal(regionVolume(region), 5 * 9 * 8);
  });
});

describe("envelope validation", () => {
  it("rejects incompatible protocolVersion", () => {
    const result = validateEnvelope({
      protocolVersion: "9.0.0",
      messageType: "poll",
      requestId: "r1",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "PROTOCOL_INCOMPATIBLE");
    }
  });

  it("accepts valid envelope", () => {
    const result = validateEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      messageType: "poll",
      requestId: "r1",
      sessionId: "s1",
      timestamp: new Date().toISOString(),
    });
    assert.equal(result.ok, true);
  });
});

describe("handshake", () => {
  it("validates a factory handshake", () => {
    const msg = createHandshake({
      sessionId: "pending",
      requestId: "req1",
      serverId: "bds-1",
    });
    const result = validateHandshake(msg);
    assert.equal(result.ok, true);
  });

  it("rejects incompatible client protocol", () => {
    const msg = createHandshake({
      sessionId: "pending",
      requestId: "req1",
      serverId: "bds-1",
    });
    const bad = { ...msg, clientProtocolVersion: "2.0.0" };
    const result = validateHandshake(bad);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "PROTOCOL_INCOMPATIBLE");
    }
  });
});

describe("action request", () => {
  it("accepts read inspect.players", () => {
    const msg = createActionRequest({
      sessionId: "s1",
      requestId: "r1",
      actionId: "a1",
      idempotencyKey: "k1",
      toolName: "inspect.players",
      arguments: {},
      actor: "admin",
    });
    const result = validateActionRequest(msg);
    assert.equal(result.ok, true);
  });

  it("rejects unknown tools", () => {
    const msg = createActionRequest({
      sessionId: "s1",
      requestId: "r1",
      actionId: "a1",
      idempotencyKey: "k1",
      toolName: "inspect.players",
      arguments: {},
      actor: "admin",
    });
    const bad = { ...msg, toolName: "mutate.fill" };
    const result = validateActionRequest(bad);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "UNKNOWN_TOOL");
    }
  });

  it("rejects a mismatched risk class", () => {
    const msg = createActionRequest({
      sessionId: "s1",
      requestId: "r1",
      actionId: "a1",
      idempotencyKey: "k1",
      toolName: "inspect.players",
      arguments: {},
      actor: "admin",
      risk: "normal",
    });
    const result = validateActionRequest(msg);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "INVALID_RISK");
    }
  });

  it("accepts and normalizes a bounded fill", () => {
    const result=validateToolArguments("world.fill_blocks",{dimension:"minecraft:overworld",region:{min:{x:2,y:64,z:2},max:{x:0,y:64,z:0}},blockType:"minecraft:stone",captureRollback:true});
    assert.equal(result.ok,true); if(result.ok){assert.deepEqual(result.value.region,{min:{x:0,y:64,z:0},max:{x:2,y:64,z:2}});assert.equal(result.value.batchSize,512);}
  });

  it("normalizes region args", () => {
    const result = validateToolArguments("inspect.region", {
      dimension: "minecraft:overworld",
      region: {
        min: { x: 10, y: 64, z: 10 },
        max: { x: 0, y: 60, z: 0 },
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.region, {
        min: { x: 0, y: 60, z: 0 },
        max: { x: 10, y: 64, z: 10 },
      });
    }
  });
});

describe("idempotency", () => {
  it("detects duplicates", () => {
    const tracker = createIdempotencyTracker();
    assert.equal(tracker.checkAndRemember("k1"), false);
    assert.equal(tracker.checkAndRemember("k1"), true);
    assert.equal(tracker.has("k1"), true);
  });
});

describe("redaction", () => {
  it("redacts secret-like keys", () => {
    const redacted = redactSecrets({
      toolName: "inspect.players",
      authorization: "Bearer secret",
      nested: { apiKey: "abc", safe: 1 },
    });
    assert.equal(redacted.authorization, "[REDACTED]");
    assert.equal(redacted.nested.apiKey, "[REDACTED]");
    assert.equal(redacted.nested.safe, 1);
  });
});
