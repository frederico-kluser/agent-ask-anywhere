import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Orchestrator } from '../llm/orchestrator.js';

const ChatBodySchema = z.object({
  message: z.string().min(1),
});

export function registerChatRoutes(app: FastifyInstance, orchestrator: Orchestrator | null): void {
  app.post('/chat', async (req, reply) => {
    if (!orchestrator) {
      return reply.code(503).send({ error: 'LLM not configured (set ANTHROPIC_API_KEY env var)' });
    }
    const parsed = ChatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
    }
    try {
      const result = await orchestrator.handle(parsed.data.message);
      return result;
    } catch (err) {
      return reply.code(500).send({ error: String(err) });
    }
  });
}
