import type { IncomingMessage, ServerResponse } from 'node:http';
import { FlowSchema, SkillFrontmatterSchema } from '@agent-ask-anywhere/shared';
import { z } from 'zod';
import { logger } from './logger.js';
import type { RunBroker } from './run-broker.js';
import { exportSkillZip, importSkillZip } from './skills/export-import.js';
import type { SkillsManager } from './skills/manager.js';
import { buildSkillZip } from './skills/template.js';

const NameRe = /^[a-z][a-z0-9-]*$/;

const RunBodySchema = z.object({
  flowId: z.string().regex(NameRe),
  flow: FlowSchema.optional(),
  slots: z.record(z.string()).default({}),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(15 * 60 * 1000)
    .optional(),
});

const ZipBodySchema = z.object({
  name: z.string().regex(NameRe),
  description: z.string().min(10),
  flow: FlowSchema,
  body: z.string().optional(),
  slots: SkillFrontmatterSchema.shape.slots.optional(),
  metadata: SkillFrontmatterSchema.shape.metadata.optional(),
  license: z.string().optional(),
});

const CreateBodySchema = ZipBodySchema;

const UpdateBodySchema = z.object({
  description: z.string().min(10).optional(),
  flow: FlowSchema.optional(),
  body: z.string().optional(),
  slots: SkillFrontmatterSchema.shape.slots.optional(),
  metadata: SkillFrontmatterSchema.shape.metadata.optional(),
});

export type RouteContext = {
  skills: SkillsManager;
  broker: RunBroker;
};

const VERSION = '1.0.0';

const ALLOWED_ORIGIN_RES = [
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^http:\/\/localhost(?::\d+)?$/,
];

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && ALLOWED_ORIGIN_RES.some((re) => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (Buffer.isBuffer(body)) {
    res.writeHead(status, { 'Content-Type': 'application/octet-stream', ...headers });
    res.end(body);
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const buf = await readBody(req);
  if (buf.length === 0) return null;
  return JSON.parse(buf.toString('utf8'));
}

export async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const route = `${req.method ?? 'GET'} ${url.pathname}`;

  try {
    if (route === 'GET /health') {
      send(res, 200, {
        ok: true,
        version: VERSION,
        skills: ctx.skills.list().length,
        extensionConnected: ctx.broker.hasExtension(),
        pid: process.pid,
      });
      return;
    }

    if (route === 'POST /run') {
      const body = await readJson(req);
      const parsed = RunBodySchema.safeParse(body);
      if (!parsed.success) {
        send(res, 400, { error: 'invalid', issues: parsed.error.issues });
        return;
      }
      const skill = ctx.skills.get(parsed.data.flowId);
      const flow = parsed.data.flow ?? skill?.flow;
      if (!flow) {
        send(res, 404, { error: `skill ${parsed.data.flowId} not found and no flow inlined` });
        return;
      }
      if (!ctx.broker.hasExtension()) {
        send(res, 503, { error: 'no extension connected to lobby' });
        return;
      }
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const result = await ctx.broker.runFlow(
          { flowId: parsed.data.flowId, flow, slots: parsed.data.slots, runId },
          parsed.data.timeoutMs ?? 5 * 60 * 1000,
        );
        send(res, 200, { runId, ...result });
      } catch (err) {
        send(res, 504, { runId, ok: false, error: String((err as Error).message ?? err) });
      }
      return;
    }

    if (route === 'POST /skills/zip') {
      const body = await readJson(req);
      const parsed = ZipBodySchema.safeParse(body);
      if (!parsed.success) {
        send(res, 400, { error: 'invalid', issues: parsed.error.issues });
        return;
      }
      const fm = SkillFrontmatterSchema.parse({
        name: parsed.data.name,
        description: parsed.data.description,
        license: parsed.data.license ?? 'MIT',
        metadata: parsed.data.metadata ?? {},
        slots: parsed.data.slots ?? [],
      });
      const buf = buildSkillZip({
        frontmatter: fm,
        body: parsed.data.body ?? defaultBody(fm),
        flow: parsed.data.flow,
      });
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fm.name}.skill"`,
        'Content-Length': String(buf.length),
      });
      res.end(buf);
      return;
    }

    if (route === 'GET /skills') {
      send(res, 200, ctx.skills.list());
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/skills/')) {
      const rest = url.pathname.slice('/skills/'.length);
      // /skills/:name/export
      if (rest.endsWith('/export')) {
        const name = rest.slice(0, -'/export'.length);
        if (!NameRe.test(name)) {
          send(res, 400, { error: 'invalid name' });
          return;
        }
        const buf = await exportSkillZip(name);
        if (!buf) {
          send(res, 404, { error: 'not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${name}.skill"`,
          'Content-Length': String(buf.length),
        });
        res.end(buf);
        return;
      }
      // /skills/:name
      const name = rest;
      if (!NameRe.test(name)) {
        send(res, 400, { error: 'invalid name' });
        return;
      }
      const skill = ctx.skills.get(name);
      if (!skill) {
        send(res, 404, { error: 'not found' });
        return;
      }
      send(res, 200, skill);
      return;
    }

    if (route === 'POST /skills') {
      const body = await readJson(req);
      const parsed = CreateBodySchema.safeParse(body);
      if (!parsed.success) {
        send(res, 400, { error: 'invalid', issues: parsed.error.issues });
        return;
      }
      if (ctx.skills.get(parsed.data.name)) {
        send(res, 409, { error: 'exists' });
        return;
      }
      const created = await ctx.skills.create(parsed.data);
      send(res, 201, created);
      return;
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/skills/')) {
      const name = url.pathname.slice('/skills/'.length);
      if (!NameRe.test(name)) {
        send(res, 400, { error: 'invalid name' });
        return;
      }
      const body = await readJson(req);
      const parsed = UpdateBodySchema.safeParse(body);
      if (!parsed.success) {
        send(res, 400, { error: 'invalid', issues: parsed.error.issues });
        return;
      }
      const updated = await ctx.skills.update(name, parsed.data);
      if (!updated) {
        send(res, 404, { error: 'not found' });
        return;
      }
      send(res, 200, updated);
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/skills/')) {
      const name = url.pathname.slice('/skills/'.length);
      if (!NameRe.test(name)) {
        send(res, 400, { error: 'invalid name' });
        return;
      }
      const ok = await ctx.skills.delete(name);
      if (!ok) {
        send(res, 404, { error: 'not found' });
        return;
      }
      send(res, 200, { ok: true });
      return;
    }

    if (route === 'POST /skills/import') {
      const ct = req.headers['content-type'] ?? '';
      const buf = await readBody(req);
      let zipBuf: Buffer;
      if (ct.includes('application/json')) {
        const obj = JSON.parse(buf.toString('utf8')) as { zip?: string };
        if (typeof obj.zip !== 'string') {
          send(res, 400, { error: 'expected {zip: base64}' });
          return;
        }
        zipBuf = Buffer.from(obj.zip, 'base64');
      } else {
        zipBuf = buf;
      }
      try {
        const result = await importSkillZip(zipBuf, ctx.skills);
        send(res, 200, result);
      } catch (err) {
        send(res, 400, { error: String((err as Error).message ?? err) });
      }
      return;
    }

    send(res, 404, { error: 'route not found', route });
  } catch (err) {
    logger.error({ err: String((err as Error).message ?? err), route }, 'http handler threw');
    send(res, 500, { error: String((err as Error).message ?? err) });
  }
}

function defaultBody(fm: { name: string; description: string }): string {
  return `# ${fm.name}\n\n${fm.description}\n`;
}
