import {
  type Flow,
  MissingSlotError,
  type Step,
  type WSMessage,
  fillFlow,
} from '@agent-ask-anywhere/shared';
import type { ExtMessage } from '../messaging.js';
import { awaitCaptchaResolve } from './captcha-watch.js';
import { executeViaCdp } from './cdp.js';
import { type SyntheticResult, syntheticRunner } from './synthetic.js';

const DEFAULT_STEP_TIMEOUT = 10_000;
const NAV_SETTLE_MS = 600;

export type RunFlowOptions = {
  tabId: number;
  flow: Flow;
  slots: Record<string, string>;
  flowId: string;
  runId: string;
};

export async function runFlow(opts: RunFlowOptions): Promise<{ ok: boolean; error?: string }> {
  setRunBadge(true);
  let filled: Flow;
  try {
    filled = fillFlow(opts.flow, opts.slots);
  } catch (err) {
    if (err instanceof MissingSlotError) {
      return { ok: false, error: `missing slot: ${err.slotName}` };
    }
    throw err;
  }
  const start = Date.now();
  for (let i = 0; i < filled.steps.length; i++) {
    const step = filled.steps[i];
    if (!step) continue;
    try {
      await awaitCaptchaResolve(opts.tabId);
    } catch (err) {
      const totalMs = Date.now() - start;
      const reason = `captcha block: ${String(err)}`;
      emitFlowResult(opts.runId, opts.flowId, false, reason, totalMs);
      return { ok: false, error: reason };
    }
    const stepStart = Date.now();
    const { ok, error, mode } = await runStep(opts.tabId, step);
    const durationMs = Date.now() - stepStart;
    emitStepResult(opts.runId, i, ok, error, durationMs);
    console.log(
      `[aaa/replay] step #${i} ${step.type} → ${ok ? 'ok' : `fail: ${error}`} (${mode}, ${durationMs}ms)`,
    );
    if (!ok) {
      const totalMs = Date.now() - start;
      emitFlowResult(opts.runId, opts.flowId, false, error, totalMs);
      setRunBadge(false);
      return { ok: false, error: `step #${i} (${step.type}): ${error}` };
    }
    if (step.type === 'navigate') {
      await waitForTabReady(opts.tabId);
      await sleep(NAV_SETTLE_MS);
    }
  }
  emitFlowResult(opts.runId, opts.flowId, true, undefined, Date.now() - start);
  setRunBadge(false);
  return { ok: true };
}

function setRunBadge(running: boolean): void {
  void chrome.action
    .setBadgeBackgroundColor({ color: running ? '#22aa44' : '#777' })
    .catch(() => {});
  void chrome.action.setBadgeText({ text: running ? 'RUN' : '' }).catch(() => {});
}

async function runStep(
  tabId: number,
  step: Step,
): Promise<{ ok: boolean; error?: string; mode: 'synthetic' | 'cdp' }> {
  const timeout =
    (step.type === 'waitForElement' || step.type === 'waitForExpression') && 'timeout' in step
      ? step.timeout
      : DEFAULT_STEP_TIMEOUT;

  if (step.type === 'navigate') {
    try {
      await chrome.tabs.update(tabId, { url: step.url });
      return { ok: true, mode: 'synthetic' };
    } catch (err) {
      return { ok: false, error: String(err), mode: 'synthetic' };
    }
  }

  if (!step.useCDP) {
    const synthetic = await runSynthetic(tabId, step, timeout);
    if (synthetic.ok) return { ...synthetic, mode: 'synthetic' };
    if (synthetic.error?.startsWith('element not found')) {
      // fall through to CDP fallback
    } else {
      return { ...synthetic, mode: 'synthetic' };
    }
  }

  try {
    const cdp = await executeViaCdp(tabId, step, timeout);
    return { ...cdp, mode: 'cdp' };
  } catch (err) {
    return { ok: false, error: String(err), mode: 'cdp' };
  }
}

async function runSynthetic(tabId: number, step: Step, timeout: number): Promise<SyntheticResult> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: syntheticRunner as (s: Step, t: number) => Promise<SyntheticResult>,
      args: [step, timeout],
    });
    let firstError: string | undefined;
    for (const r of results) {
      const value = r.result as SyntheticResult | undefined;
      if (value?.ok) return { ok: true };
      if (value && !value.ok && !firstError) firstError = value.error;
    }
    return { ok: false, error: firstError ?? 'no frame matched' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function waitForTabReady(tabId: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.status === 'complete') return;
    await sleep(150);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function emitStepResult(
  runId: string,
  stepIdx: number,
  ok: boolean,
  error: string | undefined,
  durationMs: number,
): void {
  const wsMsg: WSMessage = { type: 'step:result', runId, stepIdx, ok, error, durationMs };
  const env: ExtMessage = { kind: 'ws:outgoing', payload: wsMsg };
  void chrome.runtime.sendMessage(env).catch(() => {});
}

function emitFlowResult(
  runId: string,
  flowId: string,
  ok: boolean,
  error: string | undefined,
  durationMs: number,
): void {
  const wsMsg: WSMessage = { type: 'flow:result', runId, flowId, ok, error, durationMs };
  const env: ExtMessage = { kind: 'ws:outgoing', payload: wsMsg };
  void chrome.runtime.sendMessage(env).catch(() => {});
}
