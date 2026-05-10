import { type WSMessage, WSMessageSchema } from '@agent-ask-anywhere/shared';
import type { WebSocket, WebSocketServer } from 'ws';
import { logger } from './logger.js';
import type { RunBroker } from './run-broker.js';
import type { SkillsManager } from './skills/manager.js';
import { RecordingBuffer } from './skills/recording-buffer.js';

const HEARTBEAT_MS = 20_000;

export type WsContext = {
  skills: SkillsManager;
  broker: RunBroker;
};

type PeerState = {
  role: 'unknown' | 'extension' | 'skill-client' | 'wizard';
  unregister: (() => void) | null;
};

export function attachWsHandlers(wss: WebSocketServer, ctx: WsContext): void {
  ctx.skills.onChange((skills) => {
    const msg: WSMessage = { type: 'skills:updated', skills };
    for (const client of wss.clients) {
      send(client, msg);
    }
  });

  wss.on('connection', (ws, req) => {
    const peer = req.socket.remoteAddress ?? 'unknown';
    logger.info({ peer }, 'WS client connected');
    const buffer = new RecordingBuffer(ctx.skills);
    const state: PeerState = { role: 'unknown', unregister: null };

    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        send(ws, { type: 'ping' });
      }
    }, HEARTBEAT_MS);

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch (err) {
        logger.warn({ err: String(err) }, 'WS invalid JSON');
        return;
      }
      const result = WSMessageSchema.safeParse(parsed);
      if (!result.success) {
        logger.warn({ issues: result.error.issues }, 'WS payload failed schema');
        send(ws, {
          type: 'error',
          message: 'Invalid message',
          cause: result.error.message,
        });
        return;
      }
      void handleMessage(ws, result.data, buffer, ctx, state);
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      buffer.abort();
      state.unregister?.();
      logger.info({ peer, role: state.role }, 'WS client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err: String(err) }, 'WS error');
    });

    send(ws, { type: 'hello', client: 'lobby', version: '1.0.0' });
    send(ws, { type: 'skills:updated', skills: ctx.skills.list() });
  });
}

async function handleMessage(
  ws: WebSocket,
  msg: WSMessage,
  buffer: RecordingBuffer,
  ctx: WsContext,
  state: PeerState,
): Promise<void> {
  switch (msg.type) {
    case 'hello':
      logger.info({ client: msg.client, version: msg.version }, 'WS handshake');
      // The extension was the only WS client in the old protocol. Maintain
      // backward compatibility by treating client='extension' as a peer:register.
      if (msg.client === 'extension' && state.role === 'unknown') {
        state.role = 'extension';
        state.unregister = ctx.broker.registerExtension(ws);
      }
      break;
    case 'peer:register':
      if (state.role !== 'unknown') {
        logger.warn({ from: state.role, to: msg.role }, 'peer already registered');
        return;
      }
      state.role = msg.role;
      if (msg.role === 'extension') {
        state.unregister = ctx.broker.registerExtension(ws);
      }
      break;
    case 'ping':
      send(ws, { type: 'pong' });
      break;
    case 'pong':
      break;
    case 'record:start':
      buffer.start();
      break;
    case 'record:stop': {
      const result = await buffer.stop();
      if (result) {
        logger.info(result, 'recording saved');
      }
      break;
    }
    case 'step:recorded':
      buffer.push(msg.step);
      break;
    case 'flow:result':
    case 'step:result':
    case 'page:state':
      ctx.broker.handleIncoming(msg);
      break;
    default:
      logger.debug({ type: msg.type }, 'WS message (no handler)');
  }
}

function send(ws: WebSocket, msg: WSMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}
