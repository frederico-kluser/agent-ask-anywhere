import type { Tool } from './provider.js';

export const TOOLS: Tool[] = [
  {
    name: 'run_skill',
    description:
      "Execute an Agent Skill in the user's browser. Use when the user requests an action that matches an installed skill. Fill ALL required slots before calling. Slot type 'secret' is filled server-side from the keystore — never include secret values in the input.",
    input_schema: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'Name from the SKILL.md frontmatter',
        },
        slots: {
          type: 'object',
          description: 'Map slot_name → value, filling all required non-secret slots',
          additionalProperties: { type: 'string' },
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, validate without executing',
          default: false,
        },
      },
      required: ['skill_name', 'slots'],
    },
  },
  {
    name: 'list_skills',
    description:
      "List available skills with their descriptions and slot definitions. Call when you need to choose a skill or check a slot's expected shape.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_page_state',
    description:
      "Returns the active tab's URL, title, and a textual accessibility-tree-like view. Use during recovery if a step fails or you need to confirm UI state.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];
