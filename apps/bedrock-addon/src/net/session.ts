import { system, world } from "@minecraft/server";
import {
  createHandshake,
  createHeartbeat,
  createOperationEvent,
  createPoll,
  createIdempotencyTracker,
  isExpired,
  newId,
  validateActionRequest,
  validateHandshakeAck,
  validatePollResponse,
  type ActionRequestMessage,
} from "@intelacraft/shared-protocol";
import { notifyOperators } from "../audit/notify.js";
import type { AddonConfig } from "../config.js";
import { executeInspectTool } from "../tools/inspect/index.js";
import { executeControl, isEmergencyDisabled, startFill } from "../tools/mutate.js";
import { ControllerClient } from "./client.js";

const POLL_INTERVAL_TICKS = 40; // 2 seconds
const HEARTBEAT_EVERY_N_POLLS = 3;

export class ControllerSession {
  private client: ControllerClient;
  private sessionId: string | null = null;
  private running = false;
  private busy = false;
  private pollCount = 0;
  private readonly idempotency = createIdempotencyTracker();

  constructor(private readonly config: AddonConfig) {
    this.client = new ControllerClient(config.controllerUrl, config.authToken!);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    system.runInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_TICKS);
    void this.handshake();
  }

  private async handshake(): Promise<void> {
    try {
      const req = createHandshake({
        sessionId: "pending",
        requestId: newId("req"),
        serverId: this.config.serverId,
        capabilities: ["inspect.read"],
      });
      const res = await this.client.postJson("/v1/bds/handshake", req);
      const parsed = validateHandshakeAck(res.body);
      if (!parsed.ok || !parsed.value.ok) {
        const msg = parsed.ok
          ? parsed.value.error?.message ?? "Handshake rejected"
          : parsed.error.message;
        notifyOperators(`Handshake failed: ${msg}`);
        this.sessionId = null;
        return;
      }
      this.sessionId = parsed.value.sessionId;
      notifyOperators(`Connected to controller (session ${this.sessionId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Handshake error";
      notifyOperators(`Handshake error: ${message}`);
      this.sessionId = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.sessionId) {
        await this.handshake();
        return;
      }
      this.pollCount += 1;
      if (this.pollCount % HEARTBEAT_EVERY_N_POLLS === 0) {
        await this.sendHeartbeat();
      }
      await this.pollOnce();
    } finally {
      this.busy = false;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.sessionId) return;
    const players = world.getPlayers();
    const body = createHeartbeat({
      sessionId: this.sessionId,
      requestId: newId("req"),
      serverId: this.config.serverId,
      health: {
        ok: true,
        playerCount: players.length,
        tick: system.currentTick,
        emergencyDisabled: isEmergencyDisabled(),
      },
    });
    const res = await this.client.postJson("/v1/bds/heartbeat", body);
    if (res.status === 401) {
      this.sessionId = null;
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.sessionId) return;
    const poll = createPoll({
      sessionId: this.sessionId,
      requestId: newId("req"),
    });
    const res = await this.client.postJson("/v1/bds/poll", poll);
    if (res.status === 401) {
      this.sessionId = null;
      return;
    }
    const parsed = validatePollResponse(res.body);
    if (!parsed.ok) {
      notifyOperators(`Bad poll response: ${parsed.error.message}`);
      return;
    }
    if (!parsed.value.action) return;
    await this.handleAction(parsed.value.action);
  }

  private async handleAction(rawAction: ActionRequestMessage): Promise<void> {
    if (!this.sessionId) return;

    const validated = validateActionRequest(rawAction);
    if (!validated.ok) {
      await this.emitFailure(
        rawAction.actionId,
        validated.error.code,
        validated.error.message,
      );
      return;
    }
    const action = validated.value;

    if (isExpired(action.expiresAt)) {
      await this.emitFailure(action.actionId, "EXPIRED", "Action expired");
      return;
    }
    if (this.idempotency.checkAndRemember(action.idempotencyKey)) {
      await this.emitFailure(
        action.actionId,
        "DUPLICATE",
        "Duplicate idempotencyKey",
      );
      return;
    }

    if(action.toolName==="world.fill_blocks") { startFill(action,(event)=>{void this.emitEvent({actionId:action.actionId,...event});},this.config.protectedRegions); return; }
    if(action.toolName.startsWith("control.")) { const event=executeControl(action); await this.emitEvent({actionId:action.actionId,...event}); return; }
    const toolResult = executeInspectTool(action);
    if (!toolResult.ok) {
      await this.emitEvent({
        actionId: action.actionId,
        state: "failed",
        completedWork: 0,
        totalEstimatedWork: 1,
        message: toolResult.message,
        error: {
          code: toolResult.code,
          message: toolResult.message,
          details: toolResult.details,
        },
      });
      return;
    }

    await this.emitEvent({
      actionId: action.actionId,
      state: "completed",
      completedWork: toolResult.completedWork,
      totalEstimatedWork: toolResult.totalEstimatedWork,
      message: toolResult.message,
      result: toolResult.result,
    });
  }

  private async emitFailure(
    actionId: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.emitEvent({
      actionId,
      state: "failed",
      completedWork: 0,
      totalEstimatedWork: 1,
      message,
      error: { code, message },
    });
  }

  private async emitEvent(params: {
    actionId: string;
    state: "completed" | "failed" | "partially_completed" | "cancelled" | "running";
    completedWork: number;
    totalEstimatedWork: number;
    message: string;
    result?: unknown;
    error?: { code: string; message: string; details?: unknown };
  }): Promise<void> {
    if (!this.sessionId) return;
    const event = createOperationEvent({
      sessionId: this.sessionId,
      requestId: newId("req"),
      operationId: newId("op"),
      actionId: params.actionId,
      state: params.state,
      completedWork: params.completedWork,
      totalEstimatedWork: params.totalEstimatedWork,
      message: params.message,
      result: params.result,
      error: params.error,
    });
    await this.client.postJson("/v1/bds/events", event);
  }
}
