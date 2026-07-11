import type { IncomingMessage, ServerResponse } from "node:http";
import { readJson, sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export async function handleListProviders(ctx: AppContext, res: ServerResponse): Promise<void> {
  if (!ctx.agent) return;
  const active = ctx.agent.getActiveProvider();
  sendJson(res, 200, {
    providers: ctx.agent.listProviders(),
    activeProviderId: active.activeProviderId,
  });
}

export async function handleCreateProvider(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.agent) return;
  const b = (await readJson(req)) as any;
  sendJson(res, 201, { provider: ctx.agent.saveProvider(b) });
}

export async function handleSetActiveProvider(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.agent) return;
  const b = (await readJson(req)) as any;
  sendJson(res, 200, ctx.agent.setActiveProvider(String(b.providerId ?? "")));
}

export async function handleProviderTestOrModels(
  ctx: AppContext,
  id: string,
  action: "test" | "models",
  res: ServerResponse,
): Promise<void> {
  if (!ctx.agent) return;
  sendJson(
    res,
    200,
    action === "test" ? await ctx.agent.test(id) : { models: await ctx.agent.models(id) },
  );
}
