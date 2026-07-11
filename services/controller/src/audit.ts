import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { redactSecrets } from "@intelacraft/shared-protocol";
import type { ActivityStore } from "./activity.js";

export class AuditLog {
  private writeQueue = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly activity?: ActivityStore,
  ) {}

  append(entry: Record<string, unknown>): void {
    if (this.activity) {
      this.activity.append(entry);
      return;
    }
    const record = {
      ...redactSecrets(entry),
      loggedAt: new Date().toISOString(),
    };
    const line = `${JSON.stringify(record)}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, line, "utf8");
      })
      .catch((err) => console.error("Failed to append audit record:", err));
  }
}
