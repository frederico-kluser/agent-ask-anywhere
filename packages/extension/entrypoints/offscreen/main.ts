import { type WSMessage, WSMessageSchema } from '@agent-ask-anywhere/shared';
import { type ExtMessage, ExtMessageSchema } from '../../lib/messaging.js';

const WS_URL = 'ws://localhost:8765';
const HEARTBEAT_MS = 20_000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

let ws: WebSocket | null = null;
let backoff = MIN_BACKOFF_MS;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function broadcastStatus(connected: boolean): void {
  void chrome.runtime
    .sendMessage({ kind: 'ws:status', connected } satisfies ExtMessage)
    .catch(() => {});
}

function send(msg: WSMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function connect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  console.log('[aaa/offscreen] connecting', WS_URL);
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    console.log('[aaa/offscreen] WS open');
    backoff = MIN_BACKOFF_MS;
    broadcastStatus(true);
    send({ type: 'hello', client: 'extension', version: '1.0.0' });
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => send({ type: 'ping' }), HEARTBEAT_MS);
  });

  ws.addEventListener('message', (ev) => {
    const data = typeof ev.data === 'string' ? ev.data : '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      console.warn('[aaa/offscreen] non-JSON frame');
      return;
    }
    const result = WSMessageSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('[aaa/offscreen] invalid WS message', result.error.issues);
      return;
    }
    void chrome.runtime
      .sendMessage({
        kind: 'ws:incoming',
        payload: result.data,
      } satisfies ExtMessage)
      .catch(() => {});
  });

  ws.addEventListener('close', () => {
    console.log(`[aaa/offscreen] WS closed; retry in ${backoff}ms`);
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    broadcastStatus(false);
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  });

  ws.addEventListener('error', () => {
    // 'close' event will follow; nothing to do here beyond logging.
    console.warn('[aaa/offscreen] WS error');
  });
}

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const parsed = ExtMessageSchema.safeParse(raw);
  if (!parsed.success) return false;
  const msg = parsed.data;
  if (msg.kind === 'ws:outgoing') {
    send(msg.payload);
    return false;
  }
  if (msg.kind === 'ws:get-status') {
    sendResponse({ connected: ws?.readyState === WebSocket.OPEN });
    return false;
  }
  return false;
});

connect();
