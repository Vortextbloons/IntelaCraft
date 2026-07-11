import type { IncomingMessage, ServerResponse } from "node:http";
import { AI_MODES, type AiMode, type PermissionMode } from "@intelacraft/shared-protocol";
import { readJson, sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export async function handleCreateTask(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.agent) return;
  const b = (await readJson(req)) as any;
  const bdsSessionId = String(
    b.bdsSessionId ?? ctx.sessions.listSessions()[0]?.sessionId ?? "",
  );
  if (!bdsSessionId) {
    sendJson(res, 400, { error: { code: "NO_SESSION", message: "No BDS session" } });
    return;
  }
  const permissionMode =
    (b.permissionMode as PermissionMode | undefined) ?? ctx.settings.get().permissionMode;
  const mode = b.mode === undefined ? "ask" : String(b.mode);
  if (!(AI_MODES as readonly string[]).includes(mode)) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid mode" } });
    return;
  }
  const task = await ctx.agent.createTask({
    ...b,
    bdsSessionId,
    permissionMode,
    mode: mode as AiMode,
    sessions: ctx.sessions,
    audit: ctx.audit,
  });
  ctx.audit.append({
    type: "task_lifecycle",
    taskId: task.id,
    state: task.state,
    mode: task.mode,
    request: b.request,
  });
  sendJson(res, 201, { task });
}

export async function handleCreateTaskStream(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.agent) return;
  const b = (await readJson(req)) as any;
  const bdsSessionId = String(
    b.bdsSessionId ?? ctx.sessions.listSessions()[0]?.sessionId ?? "",
  );
  if (!bdsSessionId) {
    sendJson(res, 400, { error: { code: "NO_SESSION", message: "No BDS session" } });
    return;
  }
  const permissionMode =
    (b.permissionMode as PermissionMode | undefined) ?? ctx.settings.get().permissionMode;
  const mode = b.mode === undefined ? "ask" : String(b.mode);
  if (!(AI_MODES as readonly string[]).includes(mode)) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid mode" } });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // Prevent proxies and dev servers from collecting model deltas until the
    // response completes.  SSE only feels live when each frame is forwarded.
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  });
  res.socket?.setNoDelay(true);
  res.flushHeaders();
  const writeEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  writeEvent("ready", { ok: true });
  try {
    const task = await ctx.agent.createTaskStream(
      {
        ...b,
        bdsSessionId,
        permissionMode,
        mode: mode as AiMode,
        sessions: ctx.sessions,
        audit: ctx.audit,
      },
      (event) => {
        if (event.type === "delta") writeEvent("delta", { text: event.text });
        else if (event.type === "reasoning_delta") writeEvent("reasoning_delta", { text: event.text });
        else if (event.type === "status") writeEvent("status", { text: event.text });
        else if (event.type === "tool") writeEvent("tool", event);
      },
    );
    ctx.audit.append({
      type: "task_lifecycle",
      taskId: task.id,
      state: task.state,
      mode: task.mode,
      request: b.request,
    });
    writeEvent("task", { task });
  } catch (e) {
    writeEvent("error", {
      message: e instanceof Error ? e.message : "Planning failed",
    });
  }
  res.end();
}

export function handleListTasks(ctx: AppContext, res: ServerResponse): void {
  if (!ctx.agent) return;
  sendJson(res, 200, { tasks: ctx.agent.listTasks() });
}

export async function handleTaskAction(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string,
  action: string,
): Promise<void> {
  if (!ctx.agent) return;
  const b = (await readJson(req)) as Record<string, unknown>;
  try {
    if (action === "approve") {
      const task = ctx.agent.approveTask(taskId, {
        approvedBy: String(b.approvedBy ?? "webview"),
        sessions: ctx.sessions,
        audit: ctx.audit,
      });
      sendJson(res, 200, { task });
      return;
    }
    if (action === "reject") {
      const task = ctx.agent.rejectTask(taskId, {
        rejectedBy: String(b.rejectedBy ?? "webview"),
        audit: ctx.audit,
        reason: typeof b.reason === "string" ? b.reason : undefined,
      });
      sendJson(res, 200, { task });
      return;
    }
    if (action === "cancel") {
      const task = ctx.agent.cancelTask(taskId, {
        cancelledBy: String(b.cancelledBy ?? "webview"),
        sessions: ctx.sessions,
        audit: ctx.audit,
      });
      sendJson(res, 200, { task });
      return;
    }
    if (action === "replan") {
      const task = await ctx.agent.editAndReplan(taskId, {
        notes: String(b.notes ?? b.request ?? "Please revise the plan."),
        sessions: ctx.sessions,
        audit: ctx.audit,
        history: Array.isArray(b.history) ? (b.history as any) : undefined,
      });
      sendJson(res, 200, { task });
      return;
    }
  } catch (e: any) {
    sendJson(res, e.status ?? 500, {
      error: { code: e.code ?? "ERROR", message: e.message ?? "Task action failed" },
    });
    return;
  }
}

export async function handleContinueTaskStream(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string,
): Promise<void> {
  if (!ctx.agent) return;
  const b = (await readJson(req)) as any;
  const mode = b.mode === undefined ? undefined : String(b.mode);
  if (mode !== undefined && !(AI_MODES as readonly string[]).includes(mode)) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid mode" } });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  });
  res.socket?.setNoDelay(true);
  res.flushHeaders();
  const writeEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  writeEvent("ready", { ok: true });
  try {
    const task = await ctx.agent.continueTask(
      taskId,
      {
        ...b,
        ...(mode === undefined ? {} : { mode: mode as AiMode }),
        sessions: ctx.sessions,
        audit: ctx.audit,
      },
      (event) => {
        if (event.type === "delta") writeEvent("delta", { text: event.text });
        else if (event.type === "reasoning_delta") writeEvent("reasoning_delta", { text: event.text });
        else if (event.type === "status") writeEvent("status", { text: event.text });
        else if (event.type === "tool") writeEvent("tool", event);
      },
    );
    ctx.audit.append({
      type: "task_lifecycle",
      taskId: task.id,
      state: task.state,
      mode: task.mode,
      request: b.request,
    });
    writeEvent("task", { task });
  } catch (e) {
    writeEvent("error", {
      message: e instanceof Error ? e.message : "Continue failed",
    });
  }
  res.end();
}

export function handleGetTask(ctx: AppContext, res: ServerResponse, id: string): void {
  if (!ctx.agent) return;
  const task = ctx.agent.getTask(id);
  if (!task) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Task not found" } });
    return;
  }
  sendJson(res, 200, {
    task,
    transcript: ctx.agent.getTaskTranscript(id),
  });
}

export function handleDeleteTask(ctx: AppContext, res: ServerResponse, id: string): void {
  if (!ctx.agent) return;
  try {
    ctx.agent.deleteTask(id);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    const err = e as Error;
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: err.message } });
  }
}
