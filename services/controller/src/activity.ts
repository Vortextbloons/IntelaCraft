import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { redactSecrets } from "@intelacraft/shared-protocol";

export interface ActivityRecord {
  loggedAt: string;
  type: string;
  taskId?: string;
  actionId?: string;
  operationId?: string;
  sessionId?: string;
  serverId?: string;
  actor?: string;
  risk?: string;
  [key: string]: unknown;
}

export interface ActivityQuery {
  taskId?: string;
  actionId?: string;
  operationId?: string;
  type?: string;
  since?: string;
  limit?: number;
}

export class ActivityStore {
  private records: ActivityRecord[] = [];
  private readonly maxInMemory: number;

  constructor(
    private readonly path: string,
    private readonly retentionDays: number,
    maxInMemory = 10_000,
  ) {
    this.maxInMemory = maxInMemory;
    mkdirSync(dirname(path), { recursive: true });
    this.loadFromDisk();
    this.pruneExpired();
  }

  append(entry: Record<string, unknown>): ActivityRecord {
    const record = {
      ...redactSecrets(entry),
      loggedAt: new Date().toISOString(),
    } as ActivityRecord;
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
    this.records.push(record);
    if (this.records.length > this.maxInMemory) {
      this.records.splice(0, this.records.length - this.maxInMemory);
    }
    return record;
  }

  query(q: ActivityQuery = {}): ActivityRecord[] {
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const sinceMs = q.since ? Date.parse(q.since) : NaN;
    const filtered: ActivityRecord[] = [];
    for (let i = this.records.length - 1; i >= 0 && filtered.length < limit; i--) {
      const r = this.records[i];
      if (q.taskId && r.taskId !== q.taskId) continue;
      if (q.actionId && r.actionId !== q.actionId) continue;
      if (q.operationId && r.operationId !== q.operationId) continue;
      if (q.type && r.type !== q.type) continue;
      if (!Number.isNaN(sinceMs) && Date.parse(r.loggedAt) < sinceMs) continue;
      filtered.push(r);
    }
    filtered.reverse();
    return filtered;
  }

  purge(): { removed: number } {
    const removed = this.records.length;
    this.records = [];
    writeFileSync(this.path, "", "utf8");
    return { removed };
  }

  private loadFromDisk(): void {
    if (!existsSync(this.path)) return;
    const text = readFileSync(this.path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as ActivityRecord;
        if (parsed && typeof parsed.loggedAt === "string") {
          this.records.push(parsed);
        }
      } catch {
        // skip corrupt lines
      }
    }
    if (this.records.length > this.maxInMemory) {
      this.records = this.records.slice(-this.maxInMemory);
    }
  }

  private pruneExpired(): void {
    if (this.retentionDays <= 0) return;
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const kept = this.records.filter((r) => Date.parse(r.loggedAt) >= cutoff);
    if (kept.length === this.records.length) return;
    this.records = kept;
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : ""), "utf8");
    renameSync(tmp, this.path);
  }
}
