import { detectCaptcha } from './captcha.js';

const POLL_MS = 2_000;
const TIMEOUT_MS = 5 * 60_000; // 5 minutes max wait

export async function awaitCaptchaResolve(tabId: number): Promise<void> {
  const initial = await probe(tabId);
  if (!initial.detected) return;
  console.log(`[aaa/replay] ${initial.vendor} detected — awaiting manual resolution`);
  await notifyUser(initial.vendor ?? 'captcha');
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const r = await probe(tabId);
    if (!r.detected) {
      console.log('[aaa/replay] captcha cleared, resuming');
      return;
    }
  }
  throw new Error('captcha not resolved within timeout');
}

async function probe(tabId: number): Promise<{ detected: boolean; vendor?: string }> {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: detectCaptcha,
    });
    return (r[0]?.result as { detected: boolean; vendor?: string }) ?? { detected: false };
  } catch {
    return { detected: false };
  }
}

async function notifyUser(vendor: string): Promise<void> {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: 'agent-ask-anywhere — manual step',
      message: `${vendor} challenge detected. Solve it in the browser; the flow will resume automatically.`,
      priority: 2,
    });
  } catch {
    // notifications API may be unavailable; non-fatal
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
