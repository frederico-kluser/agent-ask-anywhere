import type { Step } from '@agent-ask-anywhere/shared';

export type SyntheticResult = { ok: true } | { ok: false; error: string };

/**
 * Self-contained executor injected via chrome.scripting.executeScript({world:'MAIN'}).
 * MUST NOT reference any module-scope value — closure is serialized away.
 */
export function syntheticRunner(step: Step, timeoutMs: number): Promise<SyntheticResult> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function pierceQuery(root: ParentNode, sel: string): Element | null {
      try {
        const direct = root.querySelector(sel);
        if (direct) return direct;
      } catch {
        return null;
      }
      const all = root.querySelectorAll('*');
      for (const e of all) {
        const sr = (e as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (sr) {
          const found = pierceQuery(sr, sel);
          if (found) return found;
        }
      }
      return null;
    }

    function xpathFind(xp: string): Element | null {
      try {
        const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return (r.singleNodeValue as Element | null) ?? null;
      } catch {
        return null;
      }
    }

    function visibleText(el: Element): string {
      const t = (el as HTMLElement).innerText ?? el.textContent ?? '';
      return t.trim();
    }

    function implicitRole(el: Element): string | null {
      const tag = el.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && (el as HTMLAnchorElement).href) return 'link';
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type;
        if (type === 'submit' || type === 'button') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      return null;
    }

    function ariaName(el: Element): string {
      const al = el.getAttribute('aria-label')?.trim();
      if (al) return al;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labels = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' ');
        if (labels) return labels;
      }
      return visibleText(el);
    }

    function ariaFind(spec: string): Element | null {
      const m = spec.match(/^([^[]+)\[name="(.+)"\]$/);
      if (!m) return null;
      const role = m[1];
      const name = m[2];
      const candidates = document.querySelectorAll(
        `[role="${role}"], button, a, input, select, textarea`,
      );
      for (const el of candidates) {
        const r = el.getAttribute('role') ?? implicitRole(el);
        if (r !== role) continue;
        if (ariaName(el) === name) return el;
      }
      return null;
    }

    function textFind(text: string): Element | null {
      const candidates = document.querySelectorAll(
        'button, a, span, label, [role="button"], [role="link"]',
      );
      for (const el of candidates) {
        if (visibleText(el) === text) return el;
      }
      return null;
    }

    function findOne(selector: string): Element | null {
      if (selector.startsWith('xpath=')) return xpathFind(selector.slice(6));
      if (selector.startsWith('text=')) {
        const inner = selector.slice(5).replace(/^"|"$/g, '');
        return textFind(inner);
      }
      if (selector.startsWith('aria/')) return ariaFind(selector.slice(5));
      return pierceQuery(document, selector);
    }

    function resolveOnce(): Element | null {
      const groups = (step as { selectors?: string[][] }).selectors ?? [];
      for (const group of groups) {
        for (const sel of group) {
          const el = findOne(sel);
          if (el) return el;
        }
      }
      return null;
    }

    function once(): void {
      let target: Element | null = null;
      const run = () => {
        if (step.type === 'waitForExpression') {
          try {
            const ok = new Function(`return Boolean(${step.expression})`)();
            if (ok) {
              resolve({ ok: true });
              return;
            }
          } catch (err) {
            resolve({ ok: false, error: `expression error: ${String(err)}` });
            return;
          }
          if (Date.now() > deadline) {
            resolve({ ok: false, error: 'waitForExpression timeout' });
            return;
          }
          setTimeout(run, 150);
          return;
        }

        target = resolveOnce();
        if (!target && step.type !== 'press') {
          if (Date.now() > deadline) {
            resolve({ ok: false, error: 'element not found' });
            return;
          }
          setTimeout(run, 150);
          return;
        }
        try {
          act(target);
          resolve({ ok: true });
        } catch (err) {
          resolve({ ok: false, error: String(err) });
        }
      };

      run();
    }

    function fireMouse(el: Element, type: string): void {
      const r = (el as HTMLElement).getBoundingClientRect();
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      });
      el.dispatchEvent(event);
    }

    function setNativeValue(el: Element, value: string): void {
      const proto =
        el instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : null;
      if (!proto) return;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, value);
    }

    function act(initial: Element | null): void {
      if (step.type === 'navigate') {
        window.location.href = step.url;
        return;
      }
      let el: Element = initial ?? document.body;
      if (!initial) {
        if (step.type === 'press') {
          el = document.activeElement ?? document.body;
        } else {
          throw new Error('no element');
        }
      }
      switch (step.type) {
        case 'click': {
          (el as HTMLElement).scrollIntoView?.({ behavior: 'instant', block: 'center' });
          fireMouse(el, 'mousedown');
          fireMouse(el, 'mouseup');
          fireMouse(el, 'click');
          break;
        }
        case 'dblclick': {
          (el as HTMLElement).scrollIntoView?.({ behavior: 'instant', block: 'center' });
          fireMouse(el, 'mousedown');
          fireMouse(el, 'mouseup');
          fireMouse(el, 'click');
          fireMouse(el, 'mousedown');
          fireMouse(el, 'mouseup');
          fireMouse(el, 'click');
          fireMouse(el, 'dblclick');
          break;
        }
        case 'type': {
          (el as HTMLElement).focus?.();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            setNativeValue(el, step.value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if ((el as HTMLElement).isContentEditable) {
            (el as HTMLElement).innerText = step.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          break;
        }
        case 'press': {
          el.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: step.key,
              bubbles: true,
              cancelable: true,
              composed: true,
            }),
          );
          el.dispatchEvent(
            new KeyboardEvent('keyup', {
              key: step.key,
              bubbles: true,
              cancelable: true,
              composed: true,
            }),
          );
          break;
        }
        case 'select': {
          if (el instanceof HTMLSelectElement) {
            el.value = step.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          break;
        }
        case 'check':
        case 'uncheck': {
          if (el instanceof HTMLInputElement) {
            el.checked = step.type === 'check';
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          break;
        }
        case 'hover': {
          fireMouse(el, 'mouseover');
          fireMouse(el, 'mouseenter');
          fireMouse(el, 'mousemove');
          break;
        }
        case 'scroll': {
          if (el) (el as HTMLElement).scrollIntoView?.({ behavior: 'instant', block: 'center' });
          else if (step.x !== undefined && step.y !== undefined) window.scrollTo(step.x, step.y);
          break;
        }
        case 'waitForElement':
          break;
      }
    }

    once();
  });
}
