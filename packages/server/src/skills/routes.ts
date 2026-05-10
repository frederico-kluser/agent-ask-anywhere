import { FlowSchema, SkillFrontmatterSchema } from '@agent-ask-anywhere/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exportSkillZip, importSkillZip } from './export-import.js';
import type { SkillsManager } from './manager.js';
import type { RunHistory } from './run-history.js';

const CreateBodySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(10),
  flow: FlowSchema,
  body: z.string().optional(),
  slots: SkillFrontmatterSchema.shape.slots.optional(),
  metadata: SkillFrontmatterSchema.shape.metadata.optional(),
  license: z.string().optional(),
});

const UpdateBodySchema = z.object({
  description: z.string().min(10).optional(),
  flow: FlowSchema.optional(),
  body: z.string().optional(),
  slots: SkillFrontmatterSchema.shape.slots.optional(),
  metadata: SkillFrontmatterSchema.shape.metadata.optional(),
});

const NameParamSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
});

export function registerSkillsRoutes(
  app: FastifyInstance,
  mgr: SkillsManager,
  history: RunHistory,
): void {
  app.get('/skills', async () => mgr.list());

  app.get('/skills/:name', async (req, reply) => {
    const params = NameParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid name' });
    const skill = mgr.get(params.data.name);
    if (!skill) return reply.code(404).send({ error: 'not found' });
    return skill;
  });

  app.post('/skills', async (req, reply) => {
    const parsed = CreateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
    }
    if (mgr.get(parsed.data.name)) {
      return reply.code(409).send({ error: 'exists' });
    }
    return await mgr.create(parsed.data);
  });

  app.put('/skills/:name', async (req, reply) => {
    const params = NameParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid name' });
    const parsed = UpdateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid', issues: parsed.error.issues });
    }
    const updated = await mgr.update(params.data.name, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  });

  app.delete('/skills/:name', async (req, reply) => {
    const params = NameParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid name' });
    const ok = await mgr.delete(params.data.name);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  app.get('/skills/:name/export', async (req, reply) => {
    const params = NameParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid name' });
    const buf = await exportSkillZip(params.data.name);
    if (!buf) return reply.code(404).send({ error: 'not found' });
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${params.data.name}.skill"`);
    return reply.send(buf);
  });

  app.post('/skills/import', async (req, reply) => {
    const body = req.body as Buffer | { zip?: string } | undefined;
    let buf: Buffer;
    if (Buffer.isBuffer(body)) {
      buf = body;
    } else if (body && typeof body === 'object' && typeof body.zip === 'string') {
      buf = Buffer.from(body.zip, 'base64');
    } else {
      return reply.code(400).send({ error: 'expected raw zip body or {zip: base64}' });
    }
    try {
      const result = await importSkillZip(buf, mgr);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: String(err) });
    }
  });

  app.get('/skills/:name/history', async (req, reply) => {
    const params = NameParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid name' });
    const runs = await history.list(params.data.name);
    return runs;
  });

  app.get('/skills/:name/history/:runId', async (req, reply) => {
    const params = NameParamSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid name' });
    const runId = (req.params as { runId?: string }).runId;
    if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
      return reply.code(400).send({ error: 'invalid runId' });
    }
    const data = await history.read(params.data.name, runId);
    if (data === null) return reply.code(404).send({ error: 'run not found' });
    reply.header('Content-Type', 'application/x-ndjson');
    return reply.send(data);
  });
}
