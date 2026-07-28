import { create } from 'zustand';

export type ChatRunPresenceStatus = 'running' | 'completed' | 'failed';

export type ChatRunPresence = {
  status: ChatRunPresenceStatus;
  startedAt: number;
  updatedAt: number;
  unread: boolean;
};

type ChatRunPresenceState = {
  runs: Record<string, ChatRunPresence>;
  markRunning: (sessionKey: string) => void;
  markCompleted: (sessionKey: string, unread: boolean) => void;
  markFailed: (sessionKey: string, unread: boolean) => void;
  markViewed: (sessionKey: string) => void;
  clear: (sessionKey: string) => void;
};

function normalizedSessionKey(sessionKey: string): string {
  return sessionKey.trim();
}

export const useChatRunPresenceStore = create<ChatRunPresenceState>((set) => ({
  runs: {},
  markRunning: (sessionKey) => {
    const key = normalizedSessionKey(sessionKey);
    if (!key) return;
    const now = Date.now();
    set((state) => {
      const current = state.runs[key];
      return {
        runs: {
          ...state.runs,
          [key]: {
            status: 'running',
            startedAt: current?.status === 'running' ? current.startedAt : now,
            updatedAt: now,
            unread: false,
          },
        },
      };
    });
  },
  markCompleted: (sessionKey, unread) => {
    const key = normalizedSessionKey(sessionKey);
    if (!key) return;
    const now = Date.now();
    set((state) => {
      const current = state.runs[key];
      return {
        runs: {
          ...state.runs,
          [key]: {
            status: 'completed',
            startedAt: current?.startedAt ?? now,
            updatedAt: now,
            unread,
          },
        },
      };
    });
  },
  markFailed: (sessionKey, unread) => {
    const key = normalizedSessionKey(sessionKey);
    if (!key) return;
    const now = Date.now();
    set((state) => {
      const current = state.runs[key];
      return {
        runs: {
          ...state.runs,
          [key]: {
            status: 'failed',
            startedAt: current?.startedAt ?? now,
            updatedAt: now,
            unread,
          },
        },
      };
    });
  },
  markViewed: (sessionKey) => {
    const key = normalizedSessionKey(sessionKey);
    if (!key) return;
    set((state) => {
      const current = state.runs[key];
      if (!current?.unread) return state;
      return {
        runs: {
          ...state.runs,
          [key]: { ...current, unread: false },
        },
      };
    });
  },
  clear: (sessionKey) => {
    const key = normalizedSessionKey(sessionKey);
    if (!key) return;
    set((state) => {
      if (!(key in state.runs)) return state;
      const { [key]: _removed, ...runs } = state.runs;
      return { runs };
    });
  },
}));

export function markChatRunRunning(sessionKey: string): void {
  useChatRunPresenceStore.getState().markRunning(sessionKey);
}

export function markChatRunCompleted(sessionKey: string, unread: boolean): void {
  useChatRunPresenceStore.getState().markCompleted(sessionKey, unread);
}

export function markChatRunFailed(sessionKey: string, unread: boolean): void {
  useChatRunPresenceStore.getState().markFailed(sessionKey, unread);
}

export function clearChatRunPresence(sessionKey: string): void {
  useChatRunPresenceStore.getState().clear(sessionKey);
}
