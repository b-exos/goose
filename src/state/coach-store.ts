/**
 * Coach chat state: transcript, API key, and send orchestration.
 *
 * Holds the user-visible message list and runs each turn through `runCoachTurn` with an
 * `OpenAIChatClient`. Tool calls execute locally against the ported metrics. The API key is
 * in memory for now (secure storage is a follow-up).
 */
import { create } from 'zustand';
import { COACH_SYSTEM_PROMPT, runCoachTurn, type ChatMessage } from '../coach/chat';
import { OpenAIChatClient } from '../coach/openai-client';

export interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CoachState {
  apiKey: string | null;
  messages: DisplayMessage[];
  transcript: ChatMessage[];
  isSending: boolean;
  error: string | null;
  setApiKey: (key: string) => void;
  sendMessage: (text: string) => Promise<void>;
  reset: () => void;
}

export const useCoachStore = create<CoachState>((set, get) => ({
  apiKey: null,
  messages: [],
  transcript: [{ role: 'system', content: COACH_SYSTEM_PROMPT }],
  isSending: false,
  error: null,

  setApiKey: (apiKey) => set({ apiKey }),

  sendMessage: async (text) => {
    const trimmed = text.trim();
    const { apiKey, transcript, isSending } = get();
    if (!trimmed || isSending) return;
    if (!apiKey) {
      set({ error: 'Add an OpenAI API key in settings to chat with your coach.' });
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    set((state) => ({
      isSending: true,
      error: null,
      messages: [...state.messages, { role: 'user', content: trimmed }],
      transcript: [...state.transcript, userMessage],
    }));

    try {
      const client = new OpenAIChatClient({ apiKey });
      const { messages: updatedTranscript, finalText } = await runCoachTurn(client, [
        ...transcript,
        userMessage,
      ]);
      set((state) => ({
        isSending: false,
        transcript: updatedTranscript,
        messages: [...state.messages, { role: 'assistant', content: finalText }],
      }));
    } catch (error) {
      set({ isSending: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  reset: () =>
    set({ messages: [], transcript: [{ role: 'system', content: COACH_SYSTEM_PROMPT }], error: null }),
}));
