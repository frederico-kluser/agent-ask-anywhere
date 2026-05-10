import { logger } from '../logger.js';
import { resolveSecrets } from '../secrets.js';
import type { SkillsManager } from '../skills/manager.js';
import type { ExtensionRpc } from './extension-rpc.js';
import type { ChatMessage, LLMProvider, ToolResultBlock, ToolUseBlock } from './provider.js';
import { TOOLS } from './tools.js';

const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT_BASE = `You are an assistant that helps the user automate tasks in their browser via "Agent Skills".

When the user requests an action:
1. If you don't recall the available skills, call list_skills first.
2. Choose the matching skill and fill its slots from the user's request.
3. Call run_skill with skill_name + slots map. Slot type 'secret' is resolved
   server-side; never put secrets in tool input.
4. If the call fails, you may call get_page_state to inspect the live UI before
   trying a recovery action.

Be concise. If a request is ambiguous, ask one short follow-up question instead
of guessing.`;

export class Orchestrator {
  private llm: LLMProvider;
  private skills: SkillsManager;
  private rpc: ExtensionRpc;

  constructor(llm: LLMProvider, skills: SkillsManager, rpc: ExtensionRpc) {
    this.llm = llm;
    this.skills = skills;
    this.rpc = rpc;
  }

  async handle(userMessage: string): Promise<{ text: string; iterations: number }> {
    const skills = this.skills.list();
    const catalog =
      skills.length === 0
        ? '(no skills installed yet)'
        : skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
    const system = `${SYSTEM_PROMPT_BASE}\n\nInstalled skills:\n${catalog}`;

    const messages: ChatMessage[] = [{ role: 'user', content: userMessage }];
    let finalText = '';
    let i = 0;

    for (i = 0; i < MAX_ITERATIONS; i++) {
      const resp = await this.llm.chat({ system, messages, tools: TOOLS });
      messages.push({ role: 'assistant', content: resp.content });

      const toolUses = resp.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      const text = resp.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      if (resp.stopReason === 'end_turn' || toolUses.length === 0) {
        finalText = text;
        break;
      }

      const toolResults: ToolResultBlock[] = [];
      for (const tu of toolUses) {
        const result = await this.dispatchTool(tu.name, tu.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result.value),
          is_error: result.error,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return { text: finalText, iterations: i + 1 };
  }

  private async dispatchTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ value: unknown; error?: boolean }> {
    try {
      if (name === 'list_skills') {
        return {
          value: this.skills.list().map((s) => {
            const full = this.skills.get(s.name);
            return {
              skill_name: s.name,
              description: s.description,
              slots: full?.frontmatter.slots ?? [],
            };
          }),
        };
      }
      if (name === 'get_page_state') {
        const state = await this.rpc.getPageState(8_000);
        return { value: { url: state.url, title: state.title, ax_tree: state.axTree } };
      }
      if (name === 'run_skill') {
        const skillName = String(input.skill_name);
        const rawSlots = (input.slots ?? {}) as Record<string, string>;
        const dryRun = Boolean(input.dry_run);
        const skill = this.skills.get(skillName);
        if (!skill) {
          return {
            value: {
              error: `unknown skill: ${skillName}`,
              available_skills: this.skills.list().map((s) => s.name),
            },
            error: true,
          };
        }
        const filled = await resolveSecrets(skill.frontmatter, rawSlots);
        if (dryRun) {
          return { value: { ok: true, dry_run: true, slot_count: Object.keys(filled).length } };
        }
        const result = await this.rpc.runFlow(
          { flowId: skillName, flow: skill.flow, slots: filled },
          90_000,
        );
        return { value: result };
      }
      return { value: { error: `unknown tool: ${name}` }, error: true };
    } catch (err) {
      logger.warn({ err: String(err), tool: name }, 'tool dispatch failed');
      return { value: { error: String(err) }, error: true };
    }
  }
}
