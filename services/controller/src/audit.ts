import { appendFileSync } from "node:fs";
import { redactSecrets } from "@intelacraft/shared-protocol";
import type { ActivityStore } from "./activity.js";

export class AuditLog {
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
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }
}
