import type { IncomingMessage, ServerResponse } from "node:http";
import { PERMISSION_MODES, THINKING_LEVELS, type PermissionMode, type ThinkingLevel } from "@intelacraft/shared-protocol";
import { readJson, sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export function handleGetSettings(ctx: AppContext, res: ServerResponse): void {
  sendJson(res, 200, {
    ...ctx.settings.get(),
    adminCommands: Object.entries(ctx.config.adminCommands).map(([id, e]) => ({
      id,
      label: e.label,
      risk: e.risk,
    })),
  });
}

export async function handlePatchSettings(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJson(req)) as { permissionMode?: string; thinkingLevel?: string };
  if (
    body.permissionMode &&
    !(PERMISSION_MODES as readonly string[]).includes(body.permissionMode)
  ) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid permissionMode" } });
    return;
  }
  if (body.thinkingLevel && !(THINKING_LEVELS as readonly string[]).includes(body.thinkingLevel)) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid thinkingLevel" } });
    return;
  }
  const next = ctx.settings.patch({
    permissionMode: body.permissionMode as PermissionMode | undefined,
    thinkingLevel: body.thinkingLevel as ThinkingLevel | undefined,
  });
  if (body.thinkingLevel && ctx.agent) {
    ctx.agent.setThinkingLevel(body.thinkingLevel as ThinkingLevel);
  }
  ctx.audit.append({ type: "settings_updated", ...next });
  sendJson(res, 200, next);
}

export async function handleEmergencyDisable(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJson(req)) as Record<string, unknown>;
  const sessionId =
    typeof body.sessionId === "string"
      ? body.sessionId
      : ctx.sessions.listSessions()[0]?.sessionId;
  if (!sessionId || !ctx.sessions.setEmergencyDisabled(sessionId, body.disabled !== false)) {
    sendJson(res, 404, { error: { code: "NO_SESSION", message: "Unknown session" } });
    return;
  }
  ctx.audit.append({
    type: "emergency_disable",
    sessionId,
    disabled: body.disabled !== false,
    actor: body.actor ?? "controller",
  });
  sendJson(res, 200, {
    ok: true,
    sessionId,
    emergencyDisabled: body.disabled !== false,
  });
}
