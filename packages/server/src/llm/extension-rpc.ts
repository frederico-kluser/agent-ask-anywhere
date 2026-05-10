import type { Flow, WSMessage } from '@agent-ask-anywhere/shared';
import type { WebSocketServer } from 'ws';
import { logger } from '../logger.js';
import type { RunHistory } from '../skills/run-history.js';

type FlowResultPayload = Extract<WSMessage, { type: 'flow:result' }>;
type StepResultPayload = Extract<WSMessage, { type: 'step:result' }>;
type PageStatePayload = Extract<WSMessage, { type: 'page:state' }>;

type RunPending = {
  resolve: (v: {
    ok: boolean;
    error?: string;
    durationMs?: number;
    steps: StepResultPayload[];
  }) => void;
  reject: (e: Error) => void;
  steps: StepResultPayload[];
};

type PagePending = {
  resolve: (v: PageStatePayload) => void;
  reject: (e: Error) => void;
};

export class ExtensionRpc {
  private pendingRuns = new Map<string, RunPending>();
  private pendingPages = new Map<string, PagePending>();
  private wss: WebSocketServer;
  private history: RunHistory | null = null;

  constructor(wss: WebSocketServer, history?: RunHistory) {
    this.wss = wss;
    this.history = history ?? null;
  }

  hasClient(): boolean {
    for (const c of this.wss.clients) {
      if (c.readyState === c.OPEN) return true;
    }
    return false;
  }

  handleIncoming(msg: WSMessage): void {
    if (msg.type === 'flow:result') {
      this.history?.end(msg);
      this.completeRun(msg);
    } else if (msg.type === 'step:result') {
      this.history?.step(msg);
      this.collectStep(msg);
    } else if (msg.type === 'page:state') {
      this.completePage(msg);
    }
  }

  private completeRun(msg: FlowResultPayload): void {
    const pending = this.pendingRuns.get(msg.runId);
    if (!pending) return;
    this.pendingRuns.delete(msg.runId);
    pending.resolve({
      ok: msg.ok,
      error: msg.error,
      durationMs: msg.durationMs,
      steps: pending.steps,
    });
  }

  private collectStep(msg: StepResultPayload): void {
    if (msg.runId) {
      const pending = this.pendingRuns.get(msg.runId);
      if (pending) {
        pending.steps.push(msg);
        return;
      }
    }
    // Fallback for legacy clients without runId: attach to all (lossy under
    // concurrency, but the LLM orchestrator runs serially).
    for (const pending of this.pendingRuns.values()) {
      pending.steps.push(msg);
    }
  }

  private completePage(msg: PageStatePayload): void {
    const pending = this.pendingPages.get(msg.requestId);
    if (!pending) return;
    this.pendingPages.delete(msg.requestId);
    pending.resolve(msg);
  }

  async runFlow(
    input: { flowId: string; flow: Flow; slots: Record<string, string> },
    timeoutMs: number,
  ): Promise<{ ok: boolean; error?: string; durationMs?: number; steps: StepResultPayload[] }> {
    if (!this.hasClient()) throw new Error('no extension connected');
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const msg: WSMessage = {
      type: 'flow:run',
      flowId: input.flowId,
      flow: input.flow,
      slots: input.slots,
      runId,
    };
    this.history?.begin(runId, input.flowId);
    return await new Promise((resolve, reject) => {
      const pending: RunPending = {
        resolve,
        reject,
        steps: [],
      };
      this.pendingRuns.set(runId, pending);
      this.broadcast(msg);
      setTimeout(() => {
        if (this.pendingRuns.has(runId)) {
          this.pendingRuns.delete(runId);
          reject(new Error('flow:run timeout'));
        }
      }, timeoutMs);
    });
  }

  async getPageState(timeoutMs: number): Promise<PageStatePayload> {
    if (!this.hasClient()) throw new Error('no extension connected');
    const requestId = `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const msg: WSMessage = { type: 'page:get-state', requestId };
    return await new Promise((resolve, reject) => {
      this.pendingPages.set(requestId, { resolve, reject });
      this.broadcast(msg);
      setTimeout(() => {
        if (this.pendingPages.has(requestId)) {
          this.pendingPages.delete(requestId);
          reject(new Error('page:get-state timeout'));
        }
      }, timeoutMs);
    });
  }

  private broadcast(msg: WSMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(json);
      }
    }
    logger.debug({ type: msg.type }, 'rpc broadcast');
  }
}
