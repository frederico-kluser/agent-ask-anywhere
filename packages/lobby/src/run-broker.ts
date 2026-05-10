import type { Flow, WSMessage } from '@agent-ask-anywhere/shared';
import type { WebSocket, WebSocketServer } from 'ws';
import { logger } from './logger.js';

type FlowResultPayload = Extract<WSMessage, { type: 'flow:result' }>;
type StepResultPayload = Extract<WSMessage, { type: 'step:result' }>;
type PageStatePayload = Extract<WSMessage, { type: 'page:state' }>;

export type RunResult = {
  ok: boolean;
  error?: string;
  durationMs?: number;
  steps: Array<Pick<StepResultPayload, 'stepIdx' | 'ok' | 'error' | 'durationMs'>>;
};

type RunPending = {
  resolve: (v: RunResult) => void;
  reject: (e: Error) => void;
  steps: Array<Pick<StepResultPayload, 'stepIdx' | 'ok' | 'error' | 'durationMs'>>;
  timer: NodeJS.Timeout;
};

type PagePending = {
  resolve: (v: PageStatePayload) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Multiplexes runs and page-state requests across a set of extension WS peers.
 * Skill clients (HTTP /run) and the wizard (HTTP /skills/zip) interact via
 * runBroker.runFlow(), which broadcasts a flow:run to the connected extension
 * and resolves when flow:result with the matching runId arrives.
 */
export class RunBroker {
  private pendingRuns = new Map<string, RunPending>();
  private pendingPages = new Map<string, PagePending>();
  private extensionPeers = new Set<WebSocket>();

  constructor(private readonly wss: WebSocketServer) {}

  registerExtension(ws: WebSocket): () => void {
    this.extensionPeers.add(ws);
    logger.info({ peers: this.extensionPeers.size }, 'extension peer registered');
    return () => {
      this.extensionPeers.delete(ws);
      logger.info({ peers: this.extensionPeers.size }, 'extension peer unregistered');
    };
  }

  hasExtension(): boolean {
    for (const ws of this.extensionPeers) {
      if (ws.readyState === ws.OPEN) return true;
    }
    return false;
  }

  handleIncoming(msg: WSMessage): void {
    if (msg.type === 'flow:result') {
      this.completeRun(msg);
    } else if (msg.type === 'step:result') {
      this.collectStep(msg);
    } else if (msg.type === 'page:state') {
      this.completePage(msg);
    }
  }

  private completeRun(msg: FlowResultPayload): void {
    const pending = this.pendingRuns.get(msg.runId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRuns.delete(msg.runId);
    pending.resolve({
      ok: msg.ok,
      error: msg.error,
      durationMs: msg.durationMs,
      steps: pending.steps,
    });
  }

  private collectStep(msg: StepResultPayload): void {
    const pending = this.pendingRuns.get(msg.runId);
    if (!pending) return;
    pending.steps.push({
      stepIdx: msg.stepIdx,
      ok: msg.ok,
      error: msg.error,
      durationMs: msg.durationMs,
    });
  }

  private completePage(msg: PageStatePayload): void {
    const pending = this.pendingPages.get(msg.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingPages.delete(msg.requestId);
    pending.resolve(msg);
  }

  async runFlow(
    input: { flowId: string; flow: Flow; slots: Record<string, string>; runId: string },
    timeoutMs: number,
  ): Promise<RunResult> {
    if (!this.hasExtension()) {
      throw new Error('no extension connected to lobby');
    }
    const msg: WSMessage = {
      type: 'flow:run',
      flowId: input.flowId,
      flow: input.flow,
      slots: input.slots,
      runId: input.runId,
    };
    return await new Promise<RunResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRuns.has(input.runId)) {
          this.pendingRuns.delete(input.runId);
          reject(new Error(`flow:run timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pendingRuns.set(input.runId, { resolve, reject, steps: [], timer });
      this.broadcastToExtension(msg);
    });
  }

  async getPageState(timeoutMs: number): Promise<PageStatePayload> {
    if (!this.hasExtension()) throw new Error('no extension connected to lobby');
    const requestId = `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const msg: WSMessage = { type: 'page:get-state', requestId };
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingPages.has(requestId)) {
          this.pendingPages.delete(requestId);
          reject(new Error(`page:get-state timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pendingPages.set(requestId, { resolve, reject, timer });
      this.broadcastToExtension(msg);
    });
  }

  broadcastToExtension(msg: WSMessage): void {
    const json = JSON.stringify(msg);
    for (const ws of this.extensionPeers) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }

  broadcastAll(msg: WSMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) client.send(json);
    }
  }
}
