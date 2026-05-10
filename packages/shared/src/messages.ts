import { z } from 'zod';
import { FlowSchema } from './flow-schema.js';

export const PeerRoleSchema = z.enum(['extension', 'skill-client', 'wizard']);
export type PeerRole = z.infer<typeof PeerRoleSchema>;

export const WSMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    client: z.enum(['extension', 'lobby', 'skill-client', 'wizard']),
    version: z.string().optional(),
  }),
  z.object({
    type: z.literal('peer:register'),
    role: PeerRoleSchema,
    runId: z.string().optional(),
  }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('record:start') }),
  z.object({ type: z.literal('record:stop') }),
  z.object({
    type: z.literal('step:recorded'),
    step: z.unknown(),
  }),
  z.object({
    type: z.literal('flow:run'),
    flowId: z.string(),
    flow: FlowSchema.optional(),
    slots: z.record(z.string()).default({}),
    runId: z.string(),
  }),
  z.object({
    type: z.literal('flow:result'),
    runId: z.string(),
    flowId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('step:result'),
    runId: z.string(),
    stepIdx: z.number().int().nonnegative(),
    ok: z.boolean(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('skills:updated'),
    skills: z.array(z.object({ name: z.string(), description: z.string() })),
  }),
  z.object({
    type: z.literal('page:get-state'),
    requestId: z.string(),
  }),
  z.object({
    type: z.literal('page:state'),
    requestId: z.string(),
    url: z.string(),
    title: z.string(),
    axTree: z.string(),
    screenshot: z.string().optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    cause: z.string().optional(),
  }),
]);

export type WSMessage = z.infer<typeof WSMessageSchema>;
