import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ContentBlock, LLMProvider, LLMResponse, Tool } from './provider.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? process.env.AAA_LLM_MODEL ?? DEFAULT_MODEL;
  }

  async chat(opts: {
    system: string;
    messages: ChatMessage[];
    tools: Tool[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: [
        {
          type: 'text',
          text: opts.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: opts.tools as never,
      messages: opts.messages as never,
    });
    return {
      stopReason: resp.stop_reason ?? 'end_turn',
      content: resp.content as ContentBlock[],
    };
  }
}
