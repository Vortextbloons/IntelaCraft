import type { ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export function handleActivityQuery(ctx: AppContext, url: URL, res: ServerResponse): void {
  const records = ctx.activity.query({
    taskId: url.searchParams.get("taskId") ?? undefined,
    actionId: url.searchParams.get("actionId") ?? undefined,
    operationId: url.searchParams.get("operationId") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 100,
  });
  sendJson(res, 200, { records });
}

export function handleActivityPurge(ctx: AppContext, res: ServerResponse): void {
  const result = ctx.activity.purge();
  ctx.audit.append({ type: "activity_purged", removed: result.removed, actor: "controller" });
  sendJson(res, 200, { ok: true, ...result });
}
