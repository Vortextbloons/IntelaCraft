import type { ControllerConfig } from "../config.js";
import type { ActivityStore } from "../activity.js";
import type { AuditLog } from "../audit.js";
import type { EventStore, SessionStore, SettingsStore } from "../store.js";
import type { AgentRuntime } from "../agent.js";
import type { CatalogService } from "../catalog.js";

export interface AppContext {
  config: ControllerConfig;
  sessions: SessionStore;
  events: EventStore;
  audit: AuditLog;
  activity: ActivityStore;
  settings: SettingsStore;
  agent?: AgentRuntime;
  catalog?: CatalogService;
}
