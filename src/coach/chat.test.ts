/** Tests the coach tool-calling loop with a scripted fake ChatClient. */
import { runCoachTurn, type ChatClient, type ChatMessage, type ChatResponse } from './chat';

/** A fake client that returns a queued response per `complete` call. */
class ScriptedClient implements ChatClient {
  calls: ChatMessage[][] = [];
  constructor(private readonly responses: ChatResponse[]) {}
  async complete(messages: ChatMessage[]): Promise<ChatResponse> {
    this.calls.push(messages);
    return this.responses[Math.min(this.calls.length - 1, this.responses.length - 1)];
  }
}

describe('runCoachTurn', () => {
  it('returns the assistant text directly when no tools are called', async () => {
    const client = new ScriptedClient([{ content: 'Stay hydrated.', toolCalls: [] }]);
    const { finalText } = await runCoachTurn(client, [{ role: 'user', content: 'tips?' }]);
    expect(finalText).toBe('Stay hydrated.');
  });

  it('executes a tool call locally and feeds the result back', async () => {
    const client = new ScriptedClient([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_1',
            name: 'compute_strain',
            arguments: JSON.stringify({
              durationMinutes: 60, restingHrBpm: 60, averageHrBpm: 120, maxHrBpm: 180,
              hrZoneMinutes: [10, 20, 30, 0, 0],
            }),
          },
        ],
      },
      { content: 'Your strain today is 8.', toolCalls: [] },
    ]);

    const { messages, finalText } = await runCoachTurn(client, [{ role: 'user', content: 'my strain?' }]);
    expect(finalText).toBe('Your strain today is 8.');

    // A tool result message was inserted carrying the computed strain score (8.05).
    const toolMessage = messages.find((m) => m.role === 'tool');
    expect(toolMessage).toBeDefined();
    expect(JSON.parse(toolMessage!.content).score0To21).toBeCloseTo(8.05, 9);
    // The second model call saw the tool result.
    expect(client.calls).toHaveLength(2);
  });

  it('stops after maxIterations of repeated tool calls', async () => {
    const looping: ChatResponse = {
      content: null,
      toolCalls: [{ id: 'c', name: 'compute_hrv', arguments: JSON.stringify({ rrIntervalsMs: [800, 810] }) }],
    };
    const client = new ScriptedClient([looping]);
    const { finalText } = await runCoachTurn(client, [{ role: 'user', content: 'loop' }], { maxIterations: 2 });
    expect(finalText).toMatch(/could not complete/);
    expect(client.calls).toHaveLength(2);
  });
});
