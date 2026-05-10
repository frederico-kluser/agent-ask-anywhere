import { type WSMessage, WSMessageSchema } from '@agent-ask-anywhere/shared';
import type { WebSocket, WebSocketServer } from 'ws';
import type { ExtensionRpc } from './llm/extension-rpc.js';
import { logger } from './logger.js';
import type { SkillsManager } from './skills/manager.js';
import { RecordingBuffer } from './skills/recording-buffer.js';

const HEARTBEAT_MS = 20_000;

export type WsContext = {
  skills: SkillsManager;
  rpc: ExtensionRpc;
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
      void handleMessage(ws, result.data, buffer, ctx);
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      buffer.abort();
      logger.info({ peer }, 'WS client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err: String(err) }, 'WS error');
    });

    send(ws, { type: 'hello', client: 'server', version: '1.0.0' });
    send(ws, { type: 'skills:updated', skills: ctx.skills.list() });
  });
}

async function handleMessage(
  ws: WebSocket,
  msg: WSMessage,
  buffer: RecordingBuffer,
  ctx: WsContext,
): Promise<void> {
  switch (msg.type) {
    case 'hello':
      logger.info({ client: msg.client, version: msg.version }, 'WS handshake');
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
      ctx.rpc.handleIncoming(msg);
      break;
    default:
      logger.debug({ type: msg.type }, 'WS message (no handler)');
  }
}

function send(ws: WebSocket, msg: WSMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}
