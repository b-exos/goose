/**
 * Coach chat orchestration: a tool-calling loop over a `ChatClient`.
 *
 * Replaces the Swift `OpenAICoachChat` turn logic. When the model requests tool calls, we
 * execute them locally via `executeCoachTool` (the ported metrics), feed the results back,
 * and continue until the model returns a final text answer. Client-agnostic and testable
 * with a fake `ChatClient`.
 */
import { COACH_TOOLS, executeCoachTool, type CoachTool } from './tools';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments. */
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

/** Minimal chat backend (OpenAI client or a fake in tests). */
export interface ChatClient {
  complete(messages: ChatMessage[], tools: CoachTool[]): Promise<ChatResponse>;
}

export const COACH_SYSTEM_PROMPT =
  'You are Goose, a concise performance coach. Use the provided tools to compute the ' +
  "athlete's recovery, strain, sleep, HRV, and stress from their data before giving advice. " +
  'Explain scores in plain language and keep answers short.';

/** Run one user-visible turn, resolving any tool calls. Returns the updated transcript. */
export async function runCoachTurn(
  client: ChatClient,
  history: ChatMessage[],
  options: { maxIterations?: number } = {},
): Promise<{ messages: ChatMessage[]; finalText: string }> {
  const maxIterations = options.maxIterations ?? 5;
  const messages = [...history];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await client.complete(messages, COACH_TOOLS);

    if (response.toolCalls.length === 0) {
      const finalText = response.content ?? '';
      messages.push({ role: 'assistant', content: finalText });
      return { messages, finalText };
    }

    // Record the assistant's tool-call request, then execute each tool locally.
    messages.push({ role: 'assistant', content: response.content ?? '', toolCalls: response.toolCalls });
    for (const call of response.toolCalls) {
      let resultJson: string;
      try {
        const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
        resultJson = JSON.stringify(executeCoachTool(call.name, args));
      } catch (error) {
        resultJson = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
      messages.push({ role: 'tool', content: resultJson, toolCallId: call.id });
    }
  }

  const finalText = 'Sorry — I could not complete that request.';
  messages.push({ role: 'assistant', content: finalText });
  return { messages, finalText };
}
