import { z } from 'zod';

export const SlotTypeSchema = z.enum(['string', 'choice', 'dynamic']);
export type SlotType = z.infer<typeof SlotTypeSchema>;

export const SlotSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'slot name must be snake_case (a-z0-9_)'),
  type: SlotTypeSchema,
  description: z.string(),
  required: z.boolean().default(true),
  enum: z.array(z.string()).optional(),
  default: z.string().optional(),
});

export type Slot = z.infer<typeof SlotSchema>;

export const SkillFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'skill name must be kebab-case (a-z0-9-)'),
  description: z.string().min(10),
  license: z.string().default('MIT'),
  metadata: z
    .object({
      version: z.string().default('1.0'),
      flow_engine: z.string().default('browser-extension-v1'),
      force_open_shadow: z.array(z.string()).optional(),
      idempotent: z.boolean().optional(),
    })
    .partial()
    .default({}),
  slots: z.array(SlotSchema).default([]),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
