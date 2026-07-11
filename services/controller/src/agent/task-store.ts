import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AgentContext, AgentTask } from "./types.js";

export function loadTasks(ctx: AgentContext) {
  const path = ctx.config.tasksPath ?? resolve(dirname(ctx.config.providersPath), "tasks.json");
  if (!existsSync(path)) return;
  try {
    const rows = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(rows)) return;
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || typeof raw.id !== "string") continue;
      const task = raw as AgentTask;
      if (!["completed", "rejected", "cancelled", "failed", "partial"].includes(task.state)) {
        task.state = "partial";
        task.error = "Controller restarted while this task was active; review world state before continuing.";
      }
      ctx.tasks.set(task.id, task);
    }
  } catch {
    // A damaged snapshot must not prevent the safety controller from starting.
  }
}

export function persistTasks(ctx: AgentContext) {
  const path = ctx.config.tasksPath ?? resolve(dirname(ctx.config.providersPath), "tasks.json");
  ctx.taskPersistencePending = true;
  if (ctx.taskPersistenceTimer || ctx.taskPersistenceInFlight) return;
  ctx.taskPersistenceTimer = setTimeout(() => {
    ctx.taskPersistenceTimer = undefined;
    // Consume this scheduled write. Events arriving while it is in flight
    // set the flag again and trigger exactly one follow-up write.
    ctx.taskPersistencePending = false;
    const payload = `${JSON.stringify([...ctx.tasks.values()], null, 2)}\n`;
    ctx.taskPersistenceInFlight = writeFile(path, payload, "utf8")
      .catch((err) => console.error("Failed to persist tasks:", err))
      .finally(() => {
        ctx.taskPersistenceInFlight = undefined;
        if (ctx.taskPersistencePending) persistTasks(ctx);
      });
  }, 50);
}

export function getTask(ctx: AgentContext, id: string) {
  const t = ctx.tasks.get(id);
  return t ? publicTask(t) : undefined;
}

export function deleteTask(ctx: AgentContext, id: string) {
  if (!ctx.tasks.has(id)) throw new Error("Task not found");
  ctx.tasks.delete(id);
  persistTasks(ctx);
}

export function listTasks(ctx: AgentContext) {
  return [...ctx.tasks.values()].map((t) => publicTask(t));
}

export function publicTask(t: AgentTask) {
  const clone = structuredClone(t);
  delete clone.pendingReads;
  delete clone.pendingVerification;
  delete clone.actionToolNames;
  return clone;
}
