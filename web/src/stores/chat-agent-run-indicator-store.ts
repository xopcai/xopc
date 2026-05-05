import { create } from 'zustand';

type ChatAgentRunIndicatorState = {
  /** Chat page route session; `active` is sending/streaming for that session only. */
  focusedSessionKey: string | null;
  focusedAgentRunActive: boolean;
  setFocusedAgentRun: (key: string | null, active: boolean) => void;
};

export const useChatAgentRunIndicatorStore = create<ChatAgentRunIndicatorState>((set) => ({
  focusedSessionKey: null,
  focusedAgentRunActive: false,
  setFocusedAgentRun: (key, active) => set({ focusedSessionKey: key, focusedAgentRunActive: active }),
}));
