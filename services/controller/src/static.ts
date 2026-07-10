import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  distPath: string,
  urlPath: string,
): boolean {
  if (!existsSync(distPath)) return false;
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  let rel = clean === "/" ? "index.html" : clean.replace(/^\//, "");
  const candidate = resolve(join(distPath, rel));
  const root = resolve(distPath);
  if (!candidate.startsWith(root + sep) && candidate !== root) return false;

  let filePath = candidate;
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = join(distPath, "index.html");
    if (!existsSync(filePath)) return false;
  }

  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  createReadStream(filePath).pipe(res);
  return true;
}
