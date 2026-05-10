import { type Flow, FlowSchema, type WSMessage } from '@agent-ask-anywhere/shared';
import { type ExtMessage, ExtMessageSchema } from '../lib/messaging.js';
import { generateAxText } from '../lib/page/ax-tree.js';
import { syncForceOpenShadow } from '../lib/replay/force-open-shadow.js';
import { runFlow } from '../lib/replay/runner.js';

const LOBBY_HTTP_URL = 'http://127.0.0.1:7878';

let recordingTabId: number | null = null;
let lastNavUrl = '';

export default defineBackground({
  type: 'module',
  main() {
    console.log('[aaa/background] service worker booted');

    chrome.runtime.onInstalled.addListener(() => {
      console.log('[aaa/background] onInstalled');
      void ensureOffscreen();
    });

    chrome.runtime.onStartup.addListener(() => {
      console.log('[aaa/background] onStartup');
      void ensureOffscreen();
    });

    chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
      const parsed = ExtMessageSchema.safeParse(raw);
      if (!parsed.success) return false;
      const msg = parsed.data;
      if (msg.kind === 'recorder:command') {
        void handleRecorderCommand(msg.cmd);
        return false;
      }
      if (msg.kind === 'recorder:get-state') {
        sendResponse({ recording: recordingTabId !== null });
        return false;
      }
      if (msg.kind === 'ws:incoming') {
        const payload = msg.payload;
        if (payload.type === 'record:start') void handleRecorderCommand('start');
        else if (payload.type === 'record:stop') void handleRecorderCommand('stop');
        else if (payload.type === 'flow:run') void handleFlowRun(payload);
        else if (payload.type === 'page:get-state') void handlePageGetState(payload.requestId);
        else if (payload.type === 'skills:updated') void refreshForceOpenShadow();
      }
      return false;
    });

    chrome.webNavigation.onCommitted.addListener((details) => {
      if (recordingTabId === null || details.tabId !== recordingTabId) return;
      if (details.frameId !== 0) return;
      if (details.url === lastNavUrl) return;
      lastNavUrl = details.url;
      const wsMsg: WSMessage = {
        type: 'step:recorded',
        step: { type: 'navigate', url: details.url },
      };
      const envelope: ExtMessage = { kind: 'ws:outgoing', payload: wsMsg };
      void chrome.runtime.sendMessage(envelope).catch(() => {});
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      if (recordingTabId === tabId) {
        recordingTabId = null;
        broadcastRecorderState(false);
      }
    });

    void ensureOffscreen();
  },
});

async function handleRecorderCommand(cmd: 'start' | 'stop'): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = active?.id;
  if (typeof tabId !== 'number') {
    console.warn('[aaa/background] no active tab for recorder command');
    return;
  }
  const wsMsg: WSMessage = { type: cmd === 'start' ? 'record:start' : 'record:stop' };
  void chrome.runtime
    .sendMessage({ kind: 'ws:outgoing', payload: wsMsg } satisfies ExtMessage)
    .catch(() => {});

  if (cmd === 'start') {
    recordingTabId = tabId;
    lastNavUrl = active?.url ?? '';
    if (active?.url) {
      const navMsg: WSMessage = {
        type: 'step:recorded',
        step: { type: 'navigate', url: active.url },
      };
      void chrome.runtime
        .sendMessage({ kind: 'ws:outgoing', payload: navMsg } satisfies ExtMessage)
        .catch(() => {});
    }
  } else {
    recordingTabId = null;
  }
  await sendToAllFrames(tabId, { kind: 'recorder:command', cmd });
  broadcastRecorderState(cmd === 'start');
}

async function handleFlowRun(payload: WSMessage & { type: 'flow:run' }): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = active?.id;
  if (typeof tabId !== 'number') {
    console.warn('[aaa/background] no active tab for flow:run');
    return;
  }
  const runId = payload.runId;
  let flow: Flow | null = payload.flow ?? null;
  if (!flow) {
    flow = await fetchFlow(payload.flowId);
  }
  if (!flow) {
    const errMsg: WSMessage = {
      type: 'flow:result',
      runId,
      flowId: payload.flowId,
      ok: false,
      error: `skill ${payload.flowId} not found`,
    };
    void chrome.runtime
      .sendMessage({ kind: 'ws:outgoing', payload: errMsg } satisfies ExtMessage)
      .catch(() => {});
    return;
  }
  await runFlow({
    tabId,
    flow,
    slots: payload.slots ?? {},
    flowId: payload.flowId,
    runId,
  });
}

async function handlePageGetState(requestId: string): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = active?.id;
  let axTree = '';
  let url = active?.url ?? '';
  let title = active?.title ?? '';
  if (typeof tabId === 'number') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: generateAxText,
      });
      axTree = (results[0]?.result as string | undefined) ?? '';
    } catch (err) {
      console.warn('[aaa/background] generateAxText failed', err);
      axTree = `<error: ${String(err)}>`;
    }
    if (!url || !title) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      url = tab?.url ?? url;
      title = tab?.title ?? title;
    }
  }
  const reply: WSMessage = {
    type: 'page:state',
    requestId,
    url,
    title,
    axTree,
  };
  void chrome.runtime
    .sendMessage({ kind: 'ws:outgoing', payload: reply } satisfies ExtMessage)
    .catch(() => {});
}

async function refreshForceOpenShadow(): Promise<void> {
  try {
    const resp = await fetch(`${LOBBY_HTTP_URL}/skills`);
    if (!resp.ok) return;
    const list = (await resp.json()) as Array<{ name: string }>;
    const detailed = await Promise.all(
      list.map(async (s) => {
        try {
          const d = await fetch(`${LOBBY_HTTP_URL}/skills/${s.name}`);
          if (!d.ok) return null;
          return (await d.json()) as {
            frontmatter?: { metadata?: { force_open_shadow?: string[] } };
          };
        } catch {
          return null;
        }
      }),
    );
    const domains = detailed.flatMap((s) => s?.frontmatter?.metadata?.force_open_shadow ?? []);
    await syncForceOpenShadow(domains);
  } catch (err) {
    console.warn('[aaa/background] refreshForceOpenShadow failed', err);
  }
}

async function fetchFlow(flowId: string): Promise<Flow | null> {
  try {
    const resp = await fetch(`${LOBBY_HTTP_URL}/skills/${encodeURIComponent(flowId)}`);
    if (!resp.ok) return null;
    const skill = (await resp.json()) as { flow?: unknown };
    const parsed = FlowSchema.safeParse(skill.flow);
    if (!parsed.success) return null;
    return parsed.data;
  } catch (err) {
    console.warn('[aaa/background] fetchFlow failed', err);
    return null;
  }
}

async function sendToAllFrames(tabId: number, message: ExtMessage): Promise<void> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames) return;
    await Promise.all(
      frames.map((frame) =>
        chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }).catch(() => {}),
      ),
    );
  } catch (err) {
    console.warn('[aaa/background] sendToAllFrames failed', err);
  }
}

function broadcastRecorderState(recording: boolean): void {
  void chrome.runtime
    .sendMessage({ kind: 'recorder:state', recording } satisfies ExtMessage)
    .catch(() => {});
  void chrome.action
    .setBadgeBackgroundColor({ color: recording ? '#ff3e00' : '#777' })
    .catch(() => {});
  void chrome.action.setBadgeText({ text: recording ? 'REC' : '' }).catch(() => {});
}

async function ensureOffscreen(): Promise<void> {
  const hasApi =
    typeof chrome.offscreen !== 'undefined' && typeof chrome.offscreen.hasDocument === 'function';
  if (!hasApi) {
    console.warn('[aaa/background] chrome.offscreen unavailable');
    return;
  }
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS' as chrome.offscreen.Reason],
      justification: 'Maintain WebSocket bridge to local lobby (port 7878)',
    });
    console.log('[aaa/background] offscreen created');
  } catch (err) {
    console.error('[aaa/background] offscreen create failed', err);
  }
}
