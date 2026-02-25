/**
 * Message Store - Centralized message state management
 */

import { createStore } from 'zustand/vanilla';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: Array<{ type: string; text?: string } >;
  attachments?: Array<{
    type: string;
    mimeType?: string;
    data?: string;
    name?: string;
    size?: number;
  }>;
  timestamp: number;
  isStreaming?: boolean;
  model?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface MessageState {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
}

export interface MessageActions {
  addMessage: (message: Omit<Message, 'id' >) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setStreaming: (isStreaming: boolean) => void;
  appendStreamingContent: (content: string) => void;
  setStreamingContent: (content: string) => void;
  setError: (error: string | null) => void;
  finalizeStreamingMessage: () => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const createMessageStore = () =>
  createStore<MessageState & MessageActions>((set, get) => ({
    messages: [],
    isStreaming: false,
    streamingContent: '',
    error: null,

    addMessage: (message) => {
      set((state) => ({
        messages: [
          ...state.messages,
          { ...message, id: generateId() },
        ],
      }));
    },

    updateMessage: (id, updates) => {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === id ? { ...msg, ...updates } : msg
        ),
      }));
    },

    removeMessage: (id) => {
      set((state) => ({
        messages: state.messages.filter((msg) => msg.id !== id),
      }));
    },

    clearMessages: () => {
      set({ messages: [], streamingContent: '', isStreaming: false });
    },

    setStreaming: (isStreaming) => {
      set({ isStreaming });
    },

    appendStreamingContent: (content) => {
      set((state) => ({
        streamingContent: state.streamingContent + content,
      }));
    },

    setStreamingContent: (content) => {
      set({ streamingContent: content });
    },

    setError: (error) => {
      set({ error });
    },

    finalizeStreamingMessage: () => {
      const { streamingContent } = get();
      if (streamingContent) {
        get().addMessage({
          role: 'assistant',
          content: [{ type: 'text', text: streamingContent }],
          timestamp: Date.now(),
        });
        set({ streamingContent: '', isStreaming: false });
      }
    },
  }));

export type MessageStore = ReturnType<typeof createMessageStore>;
