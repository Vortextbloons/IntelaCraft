import type {
  ActionRequestMessage,
  HeartbeatMessage,
  OperationEventMessage,
} from "@intelacraft/shared-protocol";
import { isExpired } from "@intelacraft/shared-protocol";

export interface BdsSession {
  sessionId: string;
  serverId: string;
  connectedAt: string;
  lastHeartbeatAt: string | null;
  lastHealth: HeartbeatMessage["health"] | null;
  protocolVersion: string;
}

export class SessionStore {
  private sessions = new Map<string, BdsSession>();
  private sessionsByServer = new Map<string, string>();
  private queues = new Map<string, ActionRequestMessage[]>();
  private seenIdempotency = new Map<string, string>();
  private emergencyDisabled = new Set<string>();
  setEmergencyDisabled(sessionId:string, value:boolean): boolean { if(!this.sessions.has(sessionId))return false; value?this.emergencyDisabled.add(sessionId):this.emergencyDisabled.delete(sessionId); return true; }
  isEmergencyDisabled(sessionId:string): boolean { return this.emergencyDisabled.has(sessionId); }

  upsertSession(session: BdsSession): void {
    const existingSessionId = this.sessionsByServer.get(session.serverId);
    if (existingSessionId && existingSessionId !== session.sessionId) {
      this.sessions.delete(existingSessionId);
      this.queues.delete(existingSessionId);
    }
    this.sessions.set(session.sessionId, session);
    this.sessionsByServer.set(session.serverId, session.sessionId);
    if (!this.queues.has(session.sessionId)) {
      this.queues.set(session.sessionId, []);
    }
  }

  getSession(sessionId: string): BdsSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByServer(serverId: string): BdsSession | undefined {
    const sessionId = this.sessionsByServer.get(serverId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  touchHeartbeat(sessionId: string, health: HeartbeatMessage["health"]): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.lastHeartbeatAt = new Date().toISOString();
    session.lastHealth = health;
    return true;
  }

  enqueue(sessionId: string, action: ActionRequestMessage): { ok: true } | { ok: false; code: string; message: string } {
    if (!this.sessions.has(sessionId)) {
      return { ok: false, code: "NO_SESSION", message: "Unknown sessionId" };
    }
    if (isExpired(action.expiresAt)) {
      return { ok: false, code: "EXPIRED", message: "Action expired" };
    }
    const prior = this.seenIdempotency.get(action.idempotencyKey);
    if (prior) {
      return {
        ok: false,
        code: "DUPLICATE",
        message: `idempotencyKey already used for action ${prior}`,
      };
    }
    this.seenIdempotency.set(action.idempotencyKey, action.actionId);
    const queue = this.queues.get(sessionId) ?? [];
    queue.push(action);
    this.queues.set(sessionId, queue);
    return { ok: true };
  }

  dequeue(sessionId: string): ActionRequestMessage | null {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.length === 0) return null;
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (this.isEmergencyDisabled(sessionId) && next.risk !== "read") continue;
      if (!isExpired(next.expiresAt)) {
        return next;
      }
    }
    return null;
  }

  listSessions(): BdsSession[] {
    return [...this.sessions.values()];
  }
}

export interface EventRecord {
  receivedAt: string;
  event: OperationEventMessage;
}

export class EventStore {
  private events: EventRecord[] = [];

  add(event: OperationEventMessage): void {
    this.events.push({ receivedAt: new Date().toISOString(), event });
    if (this.events.length > 5000) {
      this.events.splice(0, this.events.length - 5000);
    }
  }

  recent(limit = 50): EventRecord[] {
    return this.events.slice(-limit);
  }
}
