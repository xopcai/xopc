import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ChatDisplayState = {
  /** When true, assistant bubbles hide thinking and tool step UI; only text and images stay visible. */
  conciseMessageView: boolean;
  setConciseMessageView: (v: boolean) => void;
};

export const useChatDisplayStore = create(
  persist<ChatDisplayState>(
    (set) => ({
      conciseMessageView: false,
      setConciseMessageView: (conciseMessageView) => set({ conciseMessageView }),
    }),
    { name: 'xopcbot-web-chat-display' },
  ),
);
