import type { WSMessage } from '@agent-ask-anywhere/shared';
import type { ExtMessage } from '../messaging.js';
import { HOST_ID, Overlay } from './overlay.js';
import { buildSelectorChain } from './selectors.js';

let overlay: Overlay | null = null;
let recording = false;
let typingEl: Element | null = null;
let typingValue = '';
let typingTimer: ReturnType<typeof setTimeout> | null = null;

const SPECIAL_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
]);

export function isRecording(): boolean {
  return recording;
}

export function start(): void {
  if (recording) return;
  recording = true;
  overlay = new Overlay();
  overlay.mount();
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('change', onChange, true);
}

export function stop(): void {
  if (!recording) return;
  recording = false;
  flushTyping();
  document.removeEventListener('mousemove', onMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('input', onInput, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('change', onChange, true);
  overlay?.unmount();
  overlay = null;
}

function deepTarget(e: Event): Element | null {
  const path = e.composedPath();
  for (const n of path) {
    if (n instanceof Element) return n;
  }
  return null;
}

function isOurOwnNode(el: Element | null): boolean {
  if (!el) return false;
  if (el.id === HOST_ID) return true;
  return Boolean(el.closest?.(`#${HOST_ID}`));
}

function onMove(e: MouseEvent): void {
  if (!recording) return;
  const el = deepTarget(e);
  if (!el || isOurOwnNode(el)) return;
  const rect = el.getBoundingClientRect();
  const chain = buildSelectorChain(el);
  const primary = chain[0]?.[0] ?? '';
  const xpath = chain[chain.length - 1]?.[0] ?? '';
  overlay?.update(
    rect,
    `<div><b>1.</b> ${escapeHtml(primary)}</div><div><b>x.</b> ${escapeHtml(xpath)}</div>`,
  );
}

function onClick(e: MouseEvent): void {
  if (!recording) return;
  const el = deepTarget(e);
  if (!el || isOurOwnNode(el)) return;
  e.preventDefault();
  e.stopPropagation();
  flushTyping();
  emitStep({ type: 'click', selectors: buildSelectorChain(el) });
}

function onInput(e: Event): void {
  if (!recording) return;
  const el = deepTarget(e);
  if (!el || isOurOwnNode(el)) return;
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !(el as HTMLElement).isContentEditable
  ) {
    return;
  }
  if (typingEl !== el) flushTyping();
  typingEl = el;
  typingValue =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value
      : ((el as HTMLElement).innerText ?? '');
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(flushTyping, 300);
}

function flushTyping(): void {
  if (!typingEl) return;
  const el = typingEl;
  const value = typingValue;
  typingEl = null;
  typingValue = '';
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimer = null;
  }
  emitStep({ type: 'type', selectors: buildSelectorChain(el), value });
}

function onKeyDown(e: KeyboardEvent): void {
  if (!recording) return;
  if (!SPECIAL_KEYS.has(e.key)) return;
  flushTyping();
  emitStep({ type: 'press', key: e.key });
}

function onChange(e: Event): void {
  if (!recording) return;
  const el = deepTarget(e);
  if (!el || isOurOwnNode(el)) return;
  if (el instanceof HTMLSelectElement) {
    emitStep({
      type: 'select',
      selectors: buildSelectorChain(el),
      value: el.value,
    });
  } else if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      emitStep({
        type: el.checked ? 'check' : 'uncheck',
        selectors: buildSelectorChain(el),
      });
    }
  }
}

function emitStep(step: unknown): void {
  const wsMsg: WSMessage = { type: 'step:recorded', step };
  const envelope: ExtMessage = { kind: 'ws:outgoing', payload: wsMsg };
  void chrome.runtime.sendMessage(envelope).catch(() => {});
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c,
  );
}
