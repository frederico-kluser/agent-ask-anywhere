import { finder } from '@medv/finder';
import { generateXPath } from './xpath.js';

const UNSTABLE_ID = /^(ember|react-|mui-|radix-|chakra-|css-|tw-|emotion-|sc-)/i;
const UNSTABLE_CLASS = /^(ember-|react-|mui-|radix-|chakra-|css-|tw-|emotion-|sc-|jss)/i;

export function buildSelectorChain(el: Element): string[][] {
  const chain: string[][] = [];

  const testid =
    el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-tid');
  if (testid) chain.push([`[data-testid="${cssEscape(testid)}"]`]);

  if (el.id && !UNSTABLE_ID.test(el.id)) {
    chain.push([`#${CSS.escape(el.id)}`]);
  }

  const role = el.getAttribute('role') ?? implicitRole(el);
  const name = ariaName(el);
  if (role && name) {
    chain.push([`aria/${role}[name="${name}"]`]);
  }

  const tag = el.tagName.toLowerCase();
  if (name && name.length < 50 && ['button', 'a', 'span', 'label'].includes(tag)) {
    chain.push([`text="${name}"`]);
  }

  try {
    const css = finder(el, {
      idName: (n) => !UNSTABLE_ID.test(n),
      className: (c) => !UNSTABLE_CLASS.test(c),
    });
    chain.push([css]);
  } catch {
    // finder throws if no unique selector; XPath fallback below covers it
  }

  chain.push([`xpath=${generateXPath(el)}`]);

  return chain;
}

function cssEscape(v: string): string {
  return v.replace(/"/g, '\\"');
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
  const text = (el as HTMLElement).innerText?.trim();
  return text ?? '';
}

function implicitRole(el: Element): string | undefined {
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
  if (tag === 'nav') return 'navigation';
  if (tag === 'main') return 'main';
  return undefined;
}
