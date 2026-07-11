import type { IncomingMessage, ServerResponse } from "node:http";
import { readJson, sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export async function handleCreatePiSession(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.agent) return;
  const b = (await readJson(req)) as any;
  sendJson(res, 201, { session: await ctx.agent.createSession(String(b.providerId ?? "default")) });
}

export function handleListPiSessions(ctx: AppContext, res: ServerResponse): void {
  if (!ctx.agent) return;
  sendJson(res, 200, { sessions: ctx.agent.listSessions() });
}
