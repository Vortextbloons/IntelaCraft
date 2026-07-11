import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import type { AppContext } from "./types.js";

export function handleListEvents(ctx: AppContext, res: ServerResponse): void {
  sendJson(res, 200, { events: ctx.events.recent(100) });
}

export function handleEventStream(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  });
  res.socket?.setNoDelay(true);
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const unsub = ctx.events.subscribe((record) => {
    res.write(`event: operation\ndata: ${JSON.stringify(record)}\n\n`);
  });
  const keepAlive = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);
  req.on("close", () => {
    clearInterval(keepAlive);
    unsub();
  });
}
