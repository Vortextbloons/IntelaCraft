import type { ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export function handleMcpStatus(ctx: AppContext, res: ServerResponse): void {
  if (!ctx.agent) return;
  sendJson(res, 200, ctx.agent.mcp.status());
}
