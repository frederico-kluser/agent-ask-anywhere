import { type Flow, FlowSchema, type Step, StepSchema } from '@agent-ask-anywhere/shared';
import { logger } from '../logger.js';
import type { SkillsManager } from './manager.js';

export class RecordingBuffer {
  private active = false;
  private steps: Step[] = [];
  private mgr: SkillsManager;

  constructor(mgr: SkillsManager) {
    this.mgr = mgr;
  }

  start(): void {
    this.active = true;
    this.steps = [];
    logger.info('recording buffer started');
  }

  isActive(): boolean {
    return this.active;
  }

  push(rawStep: unknown): void {
    if (!this.active) return;
    const parsed = StepSchema.safeParse(rawStep);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'step skipped (invalid schema)');
      return;
    }
    this.steps.push(parsed.data);
    logger.debug({ count: this.steps.length, type: parsed.data.type }, 'step buffered');
  }

  async stop(): Promise<{ name: string; stepCount: number } | null> {
    if (!this.active) return null;
    this.active = false;
    if (this.steps.length === 0) {
      logger.info('recording stopped with 0 steps');
      return null;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `draft-${ts.toLowerCase()}`;
    const flow: Flow = FlowSchema.parse({
      version: '1.0',
      title: `Draft recorded ${ts}`,
      steps: this.steps,
    });
    await this.mgr.create({
      name,
      description: `Draft skill auto-saved on ${ts}. Edit SKILL.md to refine.`,
      flow,
    });
    const stepCount = this.steps.length;
    this.steps = [];
    logger.info({ name, stepCount }, 'draft skill saved from recording buffer');
    return { name, stepCount };
  }

  abort(): void {
    this.active = false;
    this.steps = [];
  }
}
