/**
 * OpenAI Chat Completions client implementing the coach `ChatClient` interface.
 *
 * Replaces the Swift `OpenAICoachResponsesClient`. Maps our neutral `ChatMessage`/`ToolCall`
 * shapes to the OpenAI wire format and back, including function (tool) calling. Uses `fetch`,
 * so it runs on device and is testable by injecting a fetch implementation.
 */
import type { ChatClient, ChatMessage, ChatResponse } from './chat';
import type { CoachTool } from './tools';

type FetchLike = typeof fetch;

export interface OpenAIClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

interface OpenAIToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface OpenAIChoice {
  message: { content: string | null; tool_calls?: OpenAIToolCall[] };
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

export class OpenAIChatClient implements ChatClient {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: OpenAIClientOptions) {
    this.model = options.model ?? 'gpt-4o-mini';
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(messages: ChatMessage[], tools: CoachTool[]): Promise<ChatResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toWireMessage),
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { choices: OpenAIChoice[] };
    const message = data.choices[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: (message?.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: c.function.arguments,
      })),
    };
  }
}
