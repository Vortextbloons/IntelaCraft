import type {
  ActionRequestMessage,
  HeartbeatMessage,
  OperationEventMessage,
  PermissionMode,
  ThinkingLevel,
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
  private queueHeads = new Map<string, number>();
  private seenIdempotency = new Map<string, string>();
  private emergencyDisabled = new Set<string>();

  setEmergencyDisabled(sessionId: string, value: boolean): boolean {
    if (!this.sessions.has(sessionId)) return false;
    value ? this.emergencyDisabled.add(sessionId) : this.emergencyDisabled.delete(sessionId);
    return true;
  }

  isEmergencyDisabled(sessionId: string): boolean {
    return this.emergencyDisabled.has(sessionId);
  }

  upsertSession(session: BdsSession): void {
    const existingSessionId = this.sessionsByServer.get(session.serverId);
    if (existingSessionId && existingSessionId !== session.sessionId) {
      this.sessions.delete(existingSessionId);
      // Catalog ownership is maintained by the controller context and is replaced by the new handshake.
      this.queues.delete(existingSessionId);
      this.queueHeads.delete(existingSessionId);
    }
    this.sessions.set(session.sessionId, session);
    this.sessionsByServer.set(session.serverId, session.sessionId);
    if (!this.queues.has(session.sessionId)) {
      this.queues.set(session.sessionId, []);
      this.queueHeads.set(session.sessionId, 0);
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

  enqueue(
    sessionId: string,
    action: ActionRequestMessage,
  ): { ok: true } | { ok: false; code: string; message: string } {
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

  /** Remove an action that has not been delivered to BDS yet. */
  cancelQueuedAction(sessionId: string, actionId: string): boolean {
    const queue = this.queues.get(sessionId);
    if (!queue) return false;
    const head = this.queueHeads.get(sessionId) ?? 0;
    const index = queue.findIndex(
      (action, offset) => offset >= head && action.actionId === actionId,
    );
    if (index < 0) return false;
    queue.splice(index, 1);
    return true;
  }

  dequeue(sessionId: string): ActionRequestMessage | null {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.length === 0) return null;
    let head = this.queueHeads.get(sessionId) ?? 0;
    while (head < queue.length) {
      const next = queue[head++];
      if (this.isEmergencyDisabled(sessionId) && next.risk !== "read") continue;
      if (!isExpired(next.expiresAt)) {
        this.compactQueue(sessionId, queue, head);
        return next;
      }
    }
    queue.length = 0;
    this.queueHeads.set(sessionId, 0);
    return null;
  }

  private compactQueue(sessionId: string, queue: ActionRequestMessage[], head: number): void {
    if (head >= queue.length) {
      queue.length = 0;
      this.queueHeads.set(sessionId, 0);
    } else if (head > 256 && head * 2 >= queue.length) {
      queue.splice(0, head);
      this.queueHeads.set(sessionId, 0);
    } else {
      this.queueHeads.set(sessionId, head);
    }
  }

  listSessions(): BdsSession[] {
    return [...this.sessions.values()];
  }

  expireStale(staleMs: number, now = Date.now()): string[] {
    const expired: string[] = [];
    for (const session of this.sessions.values()) {
      const last = session.lastHeartbeatAt ? Date.parse(session.lastHeartbeatAt) : Date.parse(session.connectedAt);
      if (Number.isFinite(last) && now - last > staleMs) {
        expired.push(session.sessionId);
        this.sessions.delete(session.sessionId);
        if (this.sessionsByServer.get(session.serverId) === session.sessionId) this.sessionsByServer.delete(session.serverId);
        this.queues.delete(session.sessionId); this.queueHeads.delete(session.sessionId); this.emergencyDisabled.delete(session.sessionId);
      }
    }
    return expired;
  }
}

export interface EventRecord {
  receivedAt: string;
  event: OperationEventMessage;
}

type EventListener = (record: EventRecord) => void;

export class EventStore {
  private events: EventRecord[] = [];
  private listeners = new Set<EventListener>();

  add(event: OperationEventMessage): EventRecord {
    const record: EventRecord = { receivedAt: new Date().toISOString(), event };
    this.events.push(record);
    if (this.events.length > 5000) {
      this.events.splice(0, this.events.length - 5000);
    }
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // ignore subscriber errors
      }
    }
    return record;
  }

  recent(limit = 50): EventRecord[] {
    return this.events.slice(-limit);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class SettingsStore {
  private permissionMode: PermissionMode;
  private preferredThinkingLevel: ThinkingLevel = "minimal";
  private effectiveThinkingLevel: ThinkingLevel = "minimal";

  constructor(permissionMode: PermissionMode) {
    this.permissionMode = permissionMode;
  }

  get() {
    return {
      permissionMode: this.permissionMode,
      thinkingLevel: this.effectiveThinkingLevel,
      preferredThinkingLevel: this.preferredThinkingLevel,
    };
  }

  patch(input: {
    permissionMode?: PermissionMode;
    thinkingLevel?: ThinkingLevel;
  }) {
    if (input.permissionMode) this.permissionMode = input.permissionMode;
    if (input.thinkingLevel) this.preferredThinkingLevel = input.thinkingLevel;
    return this.get();
  }

  setEffective(level: ThinkingLevel) {
    this.effectiveThinkingLevel = level;
  }
}
