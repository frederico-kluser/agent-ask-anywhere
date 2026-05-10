import { z } from 'zod';

const SelectorChain = z.array(z.array(z.string()).min(1)).min(1);

const BaseStep = {
  description: z.string().optional(),
  allowAgenticFallback: z.boolean().optional(),
  useCDP: z.boolean().optional(),
};

export const StepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string().url(), ...BaseStep }),
  z.object({ type: z.literal('click'), selectors: SelectorChain, ...BaseStep }),
  z.object({ type: z.literal('dblclick'), selectors: SelectorChain, ...BaseStep }),
  z.object({
    type: z.literal('type'),
    selectors: SelectorChain,
    value: z.string(),
    slot: z.string().optional(),
    ...BaseStep,
  }),
  z.object({
    type: z.literal('press'),
    key: z.string(),
    selectors: SelectorChain.optional(),
    ...BaseStep,
  }),
  z.object({
    type: z.literal('waitForElement'),
    selectors: SelectorChain,
    timeout: z.number().int().positive().default(10000),
    ...BaseStep,
  }),
  z.object({
    type: z.literal('waitForExpression'),
    expression: z.string(),
    timeout: z.number().int().positive().default(10000),
    ...BaseStep,
  }),
  z.object({
    type: z.literal('scroll'),
    selectors: SelectorChain.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    ...BaseStep,
  }),
  z.object({ type: z.literal('hover'), selectors: SelectorChain, ...BaseStep }),
  z.object({
    type: z.literal('select'),
    selectors: SelectorChain,
    value: z.string(),
    ...BaseStep,
  }),
  z.object({ type: z.literal('check'), selectors: SelectorChain, ...BaseStep }),
  z.object({ type: z.literal('uncheck'), selectors: SelectorChain, ...BaseStep }),
]);

export type Step = z.infer<typeof StepSchema>;

export const FlowSchema = z.object({
  version: z.literal('1.0'),
  title: z.string(),
  steps: z.array(StepSchema).min(1),
});

export type Flow = z.infer<typeof FlowSchema>;
