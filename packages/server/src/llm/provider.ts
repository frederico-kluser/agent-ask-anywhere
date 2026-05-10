export type Tool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseBlock;

export type ChatMessage =
  | { role: 'user'; content: string | ToolResultBlock[] }
  | { role: 'assistant'; content: ContentBlock[] };

export type LLMResponse = {
  stopReason: string;
  content: ContentBlock[];
};

export interface LLMProvider {
  chat(opts: {
    system: string;
    messages: ChatMessage[];
    tools: Tool[];
    maxTokens?: number;
  }): Promise<LLMResponse>;
}
