import { type WSMessage, WSMessageSchema } from '@agent-ask-anywhere/shared';
import { z } from 'zod';

export const ExtMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ws:incoming'), payload: WSMessageSchema }),
  z.object({ kind: z.literal('ws:outgoing'), payload: WSMessageSchema }),
  z.object({ kind: z.literal('ws:status'), connected: z.boolean() }),
  z.object({ kind: z.literal('ws:get-status') }),
  z.object({
    kind: z.literal('recorder:command'),
    cmd: z.enum(['start', 'stop']),
    tabId: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('recorder:state'),
    recording: z.boolean(),
  }),
  z.object({ kind: z.literal('recorder:get-state') }),
]);

export type ExtMessage = z.infer<typeof ExtMessageSchema>;

export async function sendOutgoing(payload: WSMessage): Promise<void> {
  await chrome.runtime
    .sendMessage({ kind: 'ws:outgoing', payload } satisfies ExtMessage)
    .catch(() => {});
}

export async function getWsStatus(): Promise<boolean> {
  try {
    const reply = (await chrome.runtime.sendMessage({
      kind: 'ws:get-status',
    } satisfies ExtMessage)) as { connected?: boolean } | undefined;
    return Boolean(reply?.connected);
  } catch {
    return false;
  }
}

export async function getRecorderState(): Promise<boolean> {
  try {
    const reply = (await chrome.runtime.sendMessage({
      kind: 'recorder:get-state',
    } satisfies ExtMessage)) as { recording?: boolean } | undefined;
    return Boolean(reply?.recording);
  } catch {
    return false;
  }
}

export async function commandRecorder(cmd: 'start' | 'stop'): Promise<void> {
  await chrome.runtime
    .sendMessage({ kind: 'recorder:command', cmd } satisfies ExtMessage)
    .catch(() => {});
}

export function onIncoming(handler: (msg: WSMessage) => void): () => void {
  const listener = (raw: unknown) => {
    const parsed = ExtMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    if (parsed.data.kind === 'ws:incoming') handler(parsed.data.payload);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function onStatus(handler: (connected: boolean) => void): () => void {
  const listener = (raw: unknown) => {
    const parsed = ExtMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    if (parsed.data.kind === 'ws:status') handler(parsed.data.connected);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export function onRecorderState(handler: (recording: boolean) => void): () => void {
  const listener = (raw: unknown) => {
    const parsed = ExtMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    if (parsed.data.kind === 'recorder:state') handler(parsed.data.recording);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
