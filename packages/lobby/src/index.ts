#!/usr/bin/env -S node --enable-source-maps
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handleHttpRequest } from './http-routes.js';
import { LockFileBusyError, acquireLock } from './lockfile.js';
import { logger } from './logger.js';
import { RunBroker } from './run-broker.js';
import { SkillsManager } from './skills/manager.js';
import { attachWsHandlers } from './ws.js';

const HOST = process.env.AAA_LOBBY_HOST ?? '127.0.0.1';
const PORT = Number(process.env.AAA_LOBBY_PORT ?? 7878);

async function main(): Promise<void> {
  let release: (() => void) | null = null;
  try {
    release = acquireLock(PORT);
  } catch (err) {
    if (err instanceof LockFileBusyError) {
      logger.warn(
        { existing: err.existing },
        'another lobby instance owns the lock — exiting cleanly',
      );
      process.exit(0);
    }
    throw err;
  }

  const skills = new SkillsManager();
  await skills.init();

  const httpServer = createServer((req, res) => {
    void handleHttpRequest(req, res, { skills, broker });
  });

  const wss = new WebSocketServer({ noServer: true });
  const broker = new RunBroker(wss);
  attachWsHandlers(wss, { skills, broker });

  httpServer.on('upgrade', (req, socket, head) => {
    // Parse only the pathname so query strings and fragments don't reject the
    // upgrade (e.g., a debug client connecting to /ws?token=…).
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname !== '/ws' && pathname !== '/') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  httpServer.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      logger.error({ port: PORT }, 'port already in use; another lobby may be running');
      release?.();
      process.exit(1);
    }
    logger.error({ err: String(err) }, 'http server error');
  });

  httpServer.listen(PORT, HOST, () => {
    logger.info({ host: HOST, port: PORT, pid: process.pid }, 'lobby listening (HTTP+WS)');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    release?.();
    httpServer.close(() => {
      void skills.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err: String(err) }, 'lobby failed to start');
  process.exit(1);
});
