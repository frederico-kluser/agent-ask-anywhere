import { existsSync, mkdirSync } from 'node:fs';
import { appendFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { WSMessage } from '@agent-ask-anywhere/shared';
import { logger } from '../logger.js';
import { SKILLS_ROOT } from './manager.js';

const HISTORY_ROOT = join(SKILLS_ROOT, '.history');

type StepResult = Extract<WSMessage, { type: 'step:result' }>;
type FlowResult = Extract<WSMessage, { type: 'flow:result' }>;

export class RunHistory {
  private active = new Map<string, { flowId: string; startedAt: string }>();

  ensureRoot(): void {
    if (!existsSync(HISTORY_ROOT)) mkdirSync(HISTORY_ROOT, { recursive: true });
  }

  begin(runId: string, flowId: string): void {
    this.ensureRoot();
    const startedAt = new Date().toISOString();
    this.active.set(runId, { flowId, startedAt });
    void this.append(runId, { event: 'start', flowId, ts: startedAt });
  }

  step(msg: StepResult): void {
    if (msg.runId) {
      if (!this.active.has(msg.runId)) return;
      void this.append(msg.runId, {
        event: 'step',
        stepIdx: msg.stepIdx,
        ok: msg.ok,
        error: msg.error,
        durationMs: msg.durationMs,
        ts: new Date().toISOString(),
      });
      return;
    }
    for (const [runId] of this.active) {
      void this.append(runId, {
        event: 'step',
        stepIdx: msg.stepIdx,
        ok: msg.ok,
        error: msg.error,
        durationMs: msg.durationMs,
        ts: new Date().toISOString(),
      });
    }
  }

  end(msg: FlowResult): void {
    const meta = this.active.get(msg.runId);
    if (!meta) return;
    void this.append(msg.runId, {
      event: 'end',
      ok: msg.ok,
      error: msg.error,
      durationMs: msg.durationMs,
      ts: new Date().toISOString(),
    });
    this.active.delete(msg.runId);
  }

  private async append(runId: string, entry: Record<string, unknown>): Promise<void> {
    const meta = this.active.get(runId);
    if (!meta) return;
    const dir = join(HISTORY_ROOT, meta.flowId);
    try {
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${runId}.jsonl`);
      await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (err) {
      logger.warn({ err: String(err) }, 'history append failed');
    }
  }

  async list(flowId: string): Promise<Array<{ runId: string; size: number }>> {
    const dir = join(HISTORY_ROOT, flowId);
    if (!existsSync(dir)) return [];
    try {
      const files = await readdir(dir);
      const runs = files
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ runId: f.replace(/\.jsonl$/, ''), size: 0 }));
      return runs.sort((a, b) => (a.runId < b.runId ? 1 : -1));
    } catch {
      return [];
    }
  }

  async read(flowId: string, runId: string): Promise<string | null> {
    const path = join(HISTORY_ROOT, flowId, `${runId}.jsonl`);
    if (!existsSync(path)) return null;
    return await readFile(path, 'utf8');
  }
}
