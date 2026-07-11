import type { IncomingMessage, ServerResponse } from "node:http";
import { requireAuth, sendJson } from "../http.js";
import { tryServeStatic } from "../static.js";
import { handleActivityPurge, handleActivityQuery } from "./activity-api.js";
import {
  handleBdsEvents,
  handleEnqueueAction,
  handleHandshake,
  handleHeartbeat,
  handlePoll,
} from "./bds.js";
import { handleEventStream, handleListEvents } from "./events.js";
import { handleHealth } from "./health.js";
import { handleMcpStatus } from "./mcp.js";
import { handleCreatePiSession, handleListPiSessions } from "./pi-sessions.js";
import {
  handleCreateProvider,
  handleListProviders,
  handleProviderTestOrModels,
  handleSetActiveProvider,
} from "./providers.js";
import {
  handleEmergencyDisable,
  handleGetSettings,
  handlePatchSettings,
} from "./settings.js";
import {
  handleContinueTaskStream,
  handleCreateTask,
  handleCreateTaskStream,
  handleDeleteTask,
  handleGetTask,
  handleListTasks,
  handleTaskAction,
} from "./tasks.js";
import type { AppContext } from "./types.js";

export async function handleRequest(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/v1/health") {
    return handleHealth(ctx, res);
  }

  // Static webview (unauthenticated) — API under /v1 always wins
  if (method === "GET" && !path.startsWith("/v1/")) {
    if (tryServeStatic(req, res, ctx.config.webviewDistPath, path)) return;
  }

  if (!requireAuth(req, res, ctx.config.bdsToken)) {
    return;
  }

  if (method === "POST" && path === "/v1/bds/handshake") {
    return handleHandshake(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/bds/poll") {
    return handlePoll(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/bds/events") {
    return handleBdsEvents(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/bds/heartbeat") {
    return handleHeartbeat(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/actions") {
    return handleEnqueueAction(ctx, req, res);
  }
  if (method === "GET" && path === "/v1/events") {
    return handleListEvents(ctx, res);
  }
  if (method === "GET" && path === "/v1/events/stream") {
    return handleEventStream(ctx, req, res);
  }
  if (method === "GET" && path === "/v1/activity") {
    return handleActivityQuery(ctx, url, res);
  }
  if (method === "DELETE" && path === "/v1/activity") {
    return handleActivityPurge(ctx, res);
  }
  if (method === "GET" && path === "/v1/settings") {
    return handleGetSettings(ctx, res);
  }
  if (method === "PATCH" && path === "/v1/settings") {
    return handlePatchSettings(ctx, req, res);
  }
  if (method === "POST" && path === "/v1/emergency-disable") {
    return handleEmergencyDisable(ctx, req, res);
  }

  if (ctx.agent && method === "GET" && path === "/v1/providers") {
    return handleListProviders(ctx, res);
  }
  if (ctx.agent && method === "POST" && path === "/v1/providers") {
    return handleCreateProvider(ctx, req, res);
  }
  if (ctx.agent && method === "POST" && path === "/v1/providers/active") {
    return handleSetActiveProvider(ctx, req, res);
  }
  const providerTest = /^\/v1\/providers\/([^/]+)\/(test|models)$/.exec(path);
  if (ctx.agent && method === "POST" && providerTest) {
    const id = decodeURIComponent(providerTest[1]);
    return handleProviderTestOrModels(ctx, id, providerTest[2] as "test" | "models", res);
  }
  if (ctx.agent && method === "GET" && path === "/v1/mcp/status") {
    return handleMcpStatus(ctx, res);
  }
  if (ctx.agent && method === "POST" && path === "/v1/pi/sessions") {
    return handleCreatePiSession(ctx, req, res);
  }
  if (ctx.agent && method === "GET" && path === "/v1/pi/sessions") {
    return handleListPiSessions(ctx, res);
  }
  if (ctx.agent && method === "POST" && path === "/v1/tasks") {
    return handleCreateTask(ctx, req, res);
  }
  if (ctx.agent && method === "POST" && path === "/v1/tasks/stream") {
    return handleCreateTaskStream(ctx, req, res);
  }
  if (ctx.agent && method === "GET" && path === "/v1/tasks") {
    return handleListTasks(ctx, res);
  }
  const taskAction = /^\/v1\/tasks\/([^/]+)\/(approve|reject|cancel|replan)$/.exec(path);
  if (ctx.agent && method === "POST" && taskAction) {
    const taskId = decodeURIComponent(taskAction[1]);
    const action = taskAction[2];
    return handleTaskAction(ctx, req, res, taskId, action);
  }
  const taskStreamMatch = /^\/v1\/tasks\/([^/]+)\/stream$/.exec(path);
  if (ctx.agent && method === "POST" && taskStreamMatch) {
    const taskId = decodeURIComponent(taskStreamMatch[1]);
    return handleContinueTaskStream(ctx, req, res, taskId);
  }
  const taskMatch = /^\/v1\/tasks\/([^/]+)$/.exec(path);
  if (ctx.agent && method === "GET" && taskMatch) {
    const id = decodeURIComponent(taskMatch[1]);
    return handleGetTask(ctx, res, id);
  }
  if (ctx.agent && method === "DELETE" && taskMatch) {
    const id = decodeURIComponent(taskMatch[1]);
    return handleDeleteTask(ctx, res, id);
  }

  sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
}
