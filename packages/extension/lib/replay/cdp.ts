import type { Step } from '@agent-ask-anywhere/shared';

export type CdpResult = { ok: true } | { ok: false; error: string };

const CDP_VERSION = '1.3';

type DebuggerTarget = chrome.debugger.Debuggee;

async function send<T = unknown>(
  target: DebuggerTarget,
  method: string,
  params?: unknown,
): Promise<T> {
  return await new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params as object | undefined, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result as T);
    });
  });
}

async function attach(tabId: number): Promise<DebuggerTarget> {
  const target: DebuggerTarget = { tabId };
  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach(target, CDP_VERSION, () => {
      const err = chrome.runtime.lastError;
      const errMsg = err?.message ?? '';
      if (err && !/already attached/i.test(errMsg)) reject(new Error(errMsg || 'attach failed'));
      else resolve();
    });
  });
  return target;
}

async function detach(target: DebuggerTarget): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.debugger.detach(target, () => resolve());
  });
}

function jitterDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(min + Math.random() * (max - min));
  return new Promise((r) => setTimeout(r, ms));
}

async function findElementCenter(
  target: DebuggerTarget,
  selectors: string[][],
  timeoutMs: number,
): Promise<{ x: number; y: number } | null> {
  const expr = `
    (() => {
      const groups = ${JSON.stringify(selectors)};
      function pierce(root, sel) {
        try { const d = root.querySelector(sel); if (d) return d; } catch {}
        for (const e of root.querySelectorAll('*')) if (e.shadowRoot) {
          const f = pierce(e.shadowRoot, sel);
          if (f) return f;
        }
        return null;
      }
      function xp(s) { try { const r = document.evaluate(s, document, null, 9, null); return r.singleNodeValue; } catch { return null; } }
      function findOne(s) {
        if (s.startsWith('xpath=')) return xp(s.slice(6));
        if (s.startsWith('text=')) {
          const t = s.slice(5).replace(/^"|"$/g, '');
          for (const el of document.querySelectorAll('button,a,span,label,[role="button"]')) {
            if ((el.innerText||el.textContent||'').trim() === t) return el;
          }
          return null;
        }
        return pierce(document, s);
      }
      for (const g of groups) for (const s of g) {
        const el = findOne(s);
        if (el) {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        }
      }
      return null;
    })()
  `;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await send<{ result?: { value?: { x: number; y: number } | null } }>(
      target,
      'Runtime.evaluate',
      { expression: expr, returnByValue: true },
    );
    const value = result.result?.value;
    if (value) return value;
    await jitterDelay(120, 220);
  }
  return null;
}

async function moveMouse(
  target: DebuggerTarget,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  // Bezier-ish curve with 4 control points → 5 sub-moves
  const cx1 = from.x + (to.x - from.x) * 0.3 + (Math.random() - 0.5) * 40;
  const cy1 = from.y + (to.y - from.y) * 0.2 + (Math.random() - 0.5) * 30;
  const cx2 = from.x + (to.x - from.x) * 0.7 + (Math.random() - 0.5) * 40;
  const cy2 = from.y + (to.y - from.y) * 0.8 + (Math.random() - 0.5) * 30;
  for (let t = 0; t <= 1; t += 0.2) {
    const u = 1 - t;
    const x = u ** 3 * from.x + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t ** 3 * to.x;
    const y = u ** 3 * from.y + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t ** 3 * to.y;
    await send(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    });
    await jitterDelay(8, 24);
  }
}

async function clickAt(target: DebuggerTarget, point: { x: number; y: number }): Promise<void> {
  await moveMouse(target, { x: 0, y: 0 }, point);
  await jitterDelay(30, 80);
  await send(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await jitterDelay(40, 110);
  await send(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function typeText(target: DebuggerTarget, text: string): Promise<void> {
  for (const ch of text) {
    await send(target, 'Input.insertText', { text: ch });
    await jitterDelay(40, 120);
  }
}

async function pressKey(target: DebuggerTarget, key: string): Promise<void> {
  await send(target, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: keyToCode(key),
    windowsVirtualKeyCode: keyToVk(key),
  });
  await jitterDelay(20, 60);
  await send(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: keyToCode(key),
    windowsVirtualKeyCode: keyToVk(key),
  });
}

function keyToCode(key: string): string {
  switch (key) {
    case 'Enter':
      return 'Enter';
    case 'Tab':
      return 'Tab';
    case 'Escape':
      return 'Escape';
    case 'Backspace':
      return 'Backspace';
    case 'Delete':
      return 'Delete';
    case 'ArrowUp':
      return 'ArrowUp';
    case 'ArrowDown':
      return 'ArrowDown';
    case 'ArrowLeft':
      return 'ArrowLeft';
    case 'ArrowRight':
      return 'ArrowRight';
    default:
      return `Key${key.toUpperCase()}`;
  }
}

function keyToVk(key: string): number {
  switch (key) {
    case 'Enter':
      return 13;
    case 'Tab':
      return 9;
    case 'Escape':
      return 27;
    case 'Backspace':
      return 8;
    case 'Delete':
      return 46;
    case 'ArrowUp':
      return 38;
    case 'ArrowDown':
      return 40;
    case 'ArrowLeft':
      return 37;
    case 'ArrowRight':
      return 39;
    default:
      return key.charCodeAt(0);
  }
}

export async function executeViaCdp(
  tabId: number,
  step: Step,
  timeoutMs: number,
): Promise<CdpResult> {
  const target = await attach(tabId);
  try {
    if (step.type === 'navigate') {
      await send(target, 'Page.navigate', { url: step.url });
      return { ok: true };
    }
    if (step.type === 'press') {
      await pressKey(target, step.key);
      return { ok: true };
    }
    if (step.type === 'waitForExpression') {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const r = await send<{ result?: { value?: boolean } }>(target, 'Runtime.evaluate', {
          expression: `Boolean(${step.expression})`,
          returnByValue: true,
        });
        if (r.result?.value) return { ok: true };
        await jitterDelay(120, 220);
      }
      return { ok: false, error: 'waitForExpression timeout' };
    }
    if (
      step.type === 'click' ||
      step.type === 'dblclick' ||
      step.type === 'type' ||
      step.type === 'hover' ||
      step.type === 'select' ||
      step.type === 'check' ||
      step.type === 'uncheck' ||
      step.type === 'waitForElement' ||
      step.type === 'scroll'
    ) {
      const point = await findElementCenter(target, step.selectors ?? [], timeoutMs);
      if (!point) return { ok: false, error: 'element not found' };
      if (step.type === 'click') {
        await clickAt(target, point);
        return { ok: true };
      }
      if (step.type === 'dblclick') {
        await clickAt(target, point);
        await jitterDelay(40, 90);
        await clickAt(target, point);
        return { ok: true };
      }
      if (step.type === 'type') {
        await clickAt(target, point);
        await jitterDelay(80, 160);
        await typeText(target, step.value);
        return { ok: true };
      }
      if (step.type === 'hover') {
        await moveMouse(target, { x: 0, y: 0 }, point);
        return { ok: true };
      }
      if (step.type === 'select' || step.type === 'check' || step.type === 'uncheck') {
        // CDP doesn't directly support these; fall back to JS dispatch as we already have target
        const expr = `
          (() => {
            const r = ${JSON.stringify(point)};
            const el = document.elementFromPoint(r.x, r.y);
            if (!el) return false;
            ${
              step.type === 'select'
                ? `el.value = ${JSON.stringify(step.value)}; el.dispatchEvent(new Event('change',{bubbles:true})); return true;`
                : `el.checked = ${step.type === 'check'}; el.dispatchEvent(new Event('change',{bubbles:true})); return true;`
            }
          })()
        `;
        const r = await send<{ result?: { value?: boolean } }>(target, 'Runtime.evaluate', {
          expression: expr,
          returnByValue: true,
        });
        return r.result?.value ? { ok: true } : { ok: false, error: 'CDP set failed' };
      }
      return { ok: true };
    }
    return { ok: false, error: `unsupported step type: ${(step as { type: string }).type}` };
  } finally {
    await detach(target);
  }
}
