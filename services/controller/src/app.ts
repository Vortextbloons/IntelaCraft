import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { sendJson } from "./http.js";
import { handleRequest } from "./routes/router.js";
import type { AppContext } from "./routes/types.js";

export type { AppContext } from "./routes/types.js";

export function createApp(ctx: AppContext) {
  return createServer(async (req, res) => {
    try {
      await handleRequest(ctx, req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      const errorDetails = err && typeof err === "object" ? (err as { status?: unknown; code?: unknown }) : {};
      const requestedStatus = typeof errorDetails.status === "number" ? errorDetails.status : undefined;
      const status = requestedStatus && requestedStatus >= 400 && requestedStatus < 600 ? requestedStatus : undefined;
      const code = typeof errorDetails.code === "string" ? errorDetails.code : undefined;
      if (
        status ||
        message === "Invalid JSON" ||
        message === "Body too large" ||
        message.includes("required") ||
        message.startsWith("API key") ||
        message.startsWith("Provider ") ||
        message.startsWith("Unknown provider") ||
        message.includes("invalid") ||
        message.includes("API key")
      ) {
        sendJson(res, status ?? 400, { error: { code: code ?? "BAD_REQUEST", message } });
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: { code: "INTERNAL", message } });
    }
  });
}

export { handleRequest };
