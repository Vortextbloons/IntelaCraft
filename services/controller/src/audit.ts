import { appendFileSync } from "node:fs";
import { redactSecrets } from "@intelacraft/shared-protocol";

export class AuditLog {
  constructor(private readonly path: string) {}

  append(entry: Record<string, unknown>): void {
    const record = {
      ...redactSecrets(entry),
      loggedAt: new Date().toISOString(),
    };
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }
}
