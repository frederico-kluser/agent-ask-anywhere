import { type Flow, FlowSchema, type Step } from './flow-schema.js';

const PATTERN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

export class MissingSlotError extends Error {
  constructor(public slotName: string) {
    super(`Missing slot: ${slotName}`);
    this.name = 'MissingSlotError';
  }
}

export function fillString(template: string, slots: Record<string, string>): string {
  return template.replace(PATTERN, (_, key: string) => {
    if (!(key in slots)) throw new MissingSlotError(key);
    return slots[key] ?? '';
  });
}

export function fillFlow(flow: Flow, slots: Record<string, string>): Flow {
  const filled: Flow = {
    ...flow,
    steps: flow.steps.map((step): Step => fillStep(step, slots)),
  };
  return FlowSchema.parse(filled);
}

function fillStep(step: Step, slots: Record<string, string>): Step {
  switch (step.type) {
    case 'navigate':
      return { ...step, url: fillString(step.url, slots) };
    case 'type':
      return { ...step, value: fillString(step.value, slots) };
    case 'select':
      return { ...step, value: fillString(step.value, slots) };
    case 'waitForExpression':
      return { ...step, expression: fillString(step.expression, slots) };
    default:
      return step;
  }
}
