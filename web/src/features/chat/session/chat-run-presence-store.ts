import { create } from 'zustand';

export type ChatRunPresenceStatus = 'running' | 'completed' | 'failed' | 'waiting';

export type ChatRunPresence = {
  status: ChatRunPresenceStatus;
  startedAt: number;
  updatedAt: number;
  unread: boolean;
};

type ChatRunPresenceState = {
  runs: Record<string, ChatRunPresence>;
  markRunning: (conversationId: string) => void;
  markCompleted: (conversationId: string, unread: boolean) => void;
  markFailed: (conversationId: string, unread: boolean) => void;
  markViewed: (conversationId: string) => void;
  clear: (conversationId: string) => void;
};

function normalizedConversationId(conversationId: string): string {
  return conversationId.trim();
}

export const useChatRunPresenceStore = create<ChatRunPresenceState>((set) => ({
  runs: {},
  markRunning: (conversationId) => {
    const key = normalizedConversationId(conversationId);
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
  markCompleted: (conversationId, unread) => {
    const key = normalizedConversationId(conversationId);
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
  markFailed: (conversationId, unread) => {
    const key = normalizedConversationId(conversationId);
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
  markViewed: (conversationId) => {
    const key = normalizedConversationId(conversationId);
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
  clear: (conversationId) => {
    const key = normalizedConversationId(conversationId);
    if (!key) return;
    set((state) => {
      if (!(key in state.runs)) return state;
      const { [key]: _removed, ...runs } = state.runs;
      return { runs };
    });
  },
}));

export function markChatRunRunning(conversationId: string): void {
  useChatRunPresenceStore.getState().markRunning(conversationId);
}

export function markChatRunCompleted(conversationId: string, unread: boolean): void {
  useChatRunPresenceStore.getState().markCompleted(conversationId, unread);
}

export function markChatRunFailed(conversationId: string, unread: boolean): void {
  useChatRunPresenceStore.getState().markFailed(conversationId, unread);
}

export function clearChatRunPresence(conversationId: string): void {
  useChatRunPresenceStore.getState().clear(conversationId);
}

export function markChatRunWaiting(conversationId: string): void {
  useChatRunPresenceStore.setState(state => ({ runs: { ...state.runs,
    [conversationId]: { status: 'waiting', startedAt: state.runs[conversationId]?.startedAt ?? Date.now(), updatedAt: Date.now(), unread: false },
  } }));
}
