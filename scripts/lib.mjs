#!/usr/bin/env node
/**
 * Shared helpers for IntelaCraft CLI scripts (Node, no deps).
 */
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..");

export function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return out;
}

export function ensureEnv() {
  const rootEnv = join(REPO_ROOT, ".env");
  const example = join(REPO_ROOT, ".env.example");
  const controllerExample = join(REPO_ROOT, "services", "controller", ".env.example");
  const controllerEnv = join(REPO_ROOT, "services", "controller", ".env");

  if (!existsSync(rootEnv) && existsSync(example)) {
    copyFileSync(example, rootEnv);
    console.log(`Created ${rootEnv}`);
  }
  if (!existsSync(controllerEnv) && existsSync(controllerExample)) {
    copyFileSync(controllerExample, controllerEnv);
    console.log(`Created ${controllerEnv}`);
  }

  loadEnvFile(rootEnv);
  loadEnvFile(controllerEnv);

  return {
    port: Number(process.env.PORT ?? "8787"),
    token: process.env.INTELACRAFT_BDS_TOKEN ?? "dev-change-me",
    baseUrl: process.env.INTELACRAFT_CONTROLLER_URL ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`,
  };
}

export function runNpm(args, opts = {}) {
  const result = spawnSync("npm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function printBanner(title) {
  console.log("");
  console.log(`  ${title}`);
  console.log("");
}

export async function api(baseUrl, path, { method = "GET", token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, ok: res.ok };
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}
