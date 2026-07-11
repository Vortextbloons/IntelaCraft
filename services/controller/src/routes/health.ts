import { PROTOCOL_VERSION } from "@intelacraft/shared-protocol";
import type { ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export function handleHealth(ctx: AppContext, res: ServerResponse): void {
  const now = Date.now();
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
  sendJson(res, 200, {
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    bdsConnected: sessions.some((s) => s.connected),
    sessions,
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
