import { PROTOCOL_VERSION } from "@intelacraft/shared-protocol";
import type { ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export function handleHealth(ctx: AppContext, res: ServerResponse): void {
  const now = Date.now();
  for (const sessionId of ctx.sessions.expireStale(ctx.config.heartbeatStaleMs, now)) ctx.catalog?.clear(sessionId);
  const sessions = ctx.sessions.listSessions().map((s) => {
    const ageMs = s.lastHeartbeatAt ? now - Date.parse(s.lastHeartbeatAt) : null;
    const connected =
      ageMs !== null && !Number.isNaN(ageMs) && ageMs <= ctx.config.heartbeatStaleMs;
    return {
      sessionId: s.sessionId,
      serverId: s.serverId,
      protocolVersion: s.protocolVersion,
      connectedAt: s.connectedAt,
      lastHeartbeatAt: s.lastHeartbeatAt,
      heartbeatAgeMs: ageMs,
      connected,
      health: s.lastHealth,
      emergencyDisabled: ctx.sessions.isEmergencyDisabled(s.sessionId),
    };
  });
  const catalogStatuses = sessions.map((session) => ctx.catalog?.status(session.sessionId) ?? { available: false, counts: { blocks: 0, items: 0, entities: 0 } });
  const catalog = {
    available: sessions.length > 0 && catalogStatuses.every((status) => status.available),
    counts: catalogStatuses.reduce((total, status) => ({
      blocks: total.blocks + status.counts.blocks,
      items: total.items + status.counts.items,
      entities: total.entities + status.counts.entities,
    }), { blocks: 0, items: 0, entities: 0 }),
    sessions: catalogStatuses.map((status, index) => ({ sessionId: sessions[index].sessionId, ...status })),
  };
  sendJson(res, 200, {
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    bdsConnected: sessions.some((s) => s.connected),
    sessions,
    catalog,
    settings: ctx.settings.get(),
    agent: ctx.agent
      ? {
          pi: true,
          sessions: ctx.agent.listSessions().length,
          providers: ctx.agent.listProviders().length,
          activeProviderId: ctx.agent.getActiveProvider().activeProviderId,
          mcp: ctx.agent.mcp.status(),
        }
      : { pi: false },
  });
}
