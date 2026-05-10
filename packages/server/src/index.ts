import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { registerChatRoutes } from './chat/routes.js';
import { AnthropicProvider } from './llm/anthropic.js';
import { ExtensionRpc } from './llm/extension-rpc.js';
import { Orchestrator } from './llm/orchestrator.js';
import { logger } from './logger.js';
import { SkillsManager } from './skills/manager.js';
import { registerSkillsRoutes } from './skills/routes.js';
import { RunHistory } from './skills/run-history.js';
import { attachWsHandlers } from './ws.js';

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 7860);
const WS_PORT = Number(process.env.WS_PORT ?? 8765);

async function main(): Promise<void> {
  const skills = new SkillsManager();
  await skills.init();

  const wss = new WebSocketServer({ port: WS_PORT });
  logger.info({ port: WS_PORT }, 'WS listening');
  const history = new RunHistory();
  history.ensureRoot();
  const rpc = new ExtensionRpc(wss, history);
  attachWsHandlers(wss, { skills, rpc });

  let orchestrator: Orchestrator | null = null;
  let llmStatus = 'disabled (no ANTHROPIC_API_KEY)';
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const llm = new AnthropicProvider(apiKey);
    orchestrator = new Orchestrator(llm, skills, rpc);
    llmStatus = 'enabled';
  }

  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });

  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  app.get('/health', async () => ({
    ok: true,
    wsClients: wss.clients.size,
    skillCount: skills.list().length,
    llm: llmStatus,
    version: '1.0.0',
  }));

  registerSkillsRoutes(app, skills, history);
  registerChatRoutes(app, orchestrator);

  await app.listen({ port: HTTP_PORT, host: '127.0.0.1' });
  logger.info({ port: HTTP_PORT, llm: llmStatus }, 'HTTP listening');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    wss.close();
    await skills.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err: String(err) }, 'server failed to start');
  process.exit(1);
});
