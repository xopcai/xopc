import { create } from 'zustand';

import type { Message, ProgressState, ReasoningLevel } from '@/features/chat/messages/messages.types';
import { hasPendingAgentRunForChat } from '@/features/chat/messages/message-sender';
import { mergeConsecutiveAssistantMessages } from '@/features/chat/messages/agent-messages';
import { mergeMissingUserMessagesFromServer } from '@/features/chat/messages/merge-missing-user-messages';
import {
  shouldReplaceOptimisticUserRow,
  userMessagesEquivalent,
} from '@/features/chat/messages/user-message-from-sse';
import { isUiUserMessage } from '@/features/chat/messages/user-round-index';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { chatRunManager } from '@/features/chat/session/chat-run-manager';
import { cloneMessageForRender, ensureAssistantMessage } from '@/features/chat/messages/streaming';

/** Per-session chat UI + agent config (Phase 4). @see docs/web/chat-session-semantics.md */
export type ChatSessionSlice = {
  name: string | null;
  model: string;
  thinkingLevel: string;
  reasoningLevel: ReasoningLevel;
  modelSupportsThinking: boolean;
  messages: Message[];
  hasMore: boolean;
  streamingMsg: Message | null;
  progress: ProgressState | null;
  sending: boolean;
  streaming: boolean;
};

type ChatSessionStoreState = {
  focusedSessionKey: string | null;
  initLoading: boolean;
  loadingMore: boolean;
  shellError: string | null;
  sessions: Record<string, ChatSessionSlice>;
};

type ChatSessionStoreActions = {
  setFocusedSessionKey: (key: string | null) => void;
  setInitLoading: (loading: boolean) => void;
  setLoadingMore: (loading: boolean) => void;
  setShellError: (error: string | null) => void;
  patchSessionMeta: (
    sessionKey: string,
    partial: Partial<
      Pick<
        ChatSessionSlice,
        'name' | 'model' | 'thinkingLevel' | 'reasoningLevel' | 'modelSupportsThinking'
      >
    >,
  ) => void;
  initSessionSnapshot: (sessionKey: string, snapshot: ChatSessionSlice) => void;
  setCommittedSnapshot: (
    sessionKey: string,
    data: { messages: Message[]; hasMore: boolean; name?: string | null },
  ) => void;
  updateSessionMessages: (
    sessionKey: string,
    updater: (prev: Message[]) => Message[],
  ) => void;
  finalizeStreamingTurn: (sessionKey: string, messages: Message[]) => void;
  clearStreamingState: (sessionKey: string) => void;
  clearSession: (sessionKey: string) => void;
  getSessionSnapshot: (sessionKey: string) => ChatSessionSlice | undefined;
  seedSessionIfEmpty: (
    sessionKey: string,
    messages: Message[],
    sending: boolean,
    streaming: boolean,
    hasMore?: boolean,
  ) => void;
  setSessionFlags: (
    sessionKey: string,
    partial: Partial<Pick<ChatSessionSlice, 'sending' | 'streaming'>>,
  ) => void;
  setSessionProgress: (sessionKey: string, progress: ProgressState | null) => void;
  mutateSessionStreaming: (
    sessionKey: string,
    mutator: (msg: Message) => void,
    timestamp?: number,
  ) => void;
  applyHydratedTail: (
    sessionKey: string,
    messagesWithoutTail: Message[],
    tail: Message | null,
  ) => void;
  prependHistoryMessages: (sessionKey: string, older: Message[], hasMore: boolean) => void;
  appendUserMessageIfMissing: (sessionKey: string, message: Message) => void;
  mergeCommittedFromServer: (
    sessionKey: string,
    serverMessages: Message[],
    hasMore?: boolean,
  ) => void;
};

const IDLE_STREAM: Pick<ChatSessionSlice, 'streamingMsg' | 'progress' | 'sending' | 'streaming'> = {
  streamingMsg: null,
  progress: null,
  sending: false,
  streaming: false,
};

function cloneMessages(messages: Message[]): Message[] {
  return messages.map((m) => cloneMessageForRender(m));
}

function cloneSlice(slice: ChatSessionSlice): ChatSessionSlice {
  return {
    name: slice.name,
    model: slice.model,
    thinkingLevel: slice.thinkingLevel,
    reasoningLevel: slice.reasoningLevel,
    modelSupportsThinking: slice.modelSupportsThinking,
    messages: cloneMessages(slice.messages),
    hasMore: slice.hasMore,
    streamingMsg: slice.streamingMsg ? cloneMessageForRender(slice.streamingMsg) : null,
    progress: slice.progress,
    sending: slice.sending,
    streaming: slice.streaming,
  };
}

function normalizeKey(sessionKey: string): string {
  return String(sessionKey ?? '').trim();
}

function metaFrom(current: ChatSessionSlice | undefined): Pick<
  ChatSessionSlice,
  'name' | 'model' | 'thinkingLevel' | 'reasoningLevel' | 'modelSupportsThinking'
> {
  if (!current) return defaultSessionMeta();
  return {
    name: current.name,
    model: current.model,
    thinkingLevel: current.thinkingLevel,
    reasoningLevel: current.reasoningLevel,
    modelSupportsThinking: current.modelSupportsThinking,
  };
}

export const useChatSessionStore = create<ChatSessionStoreState & ChatSessionStoreActions>(
  (set, get) => ({
    focusedSessionKey: null,
    initLoading: true,
    loadingMore: false,
    shellError: null,
    sessions: {},

    setFocusedSessionKey: (key) => set({ focusedSessionKey: key }),
    setInitLoading: (loading) => set({ initLoading: loading }),
    setLoadingMore: (loading) => set({ loadingMore: loading }),
    setShellError: (error) => set({ shellError: error }),

    patchSessionMeta: (sessionKey, partial) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        const base = current ?? { ...defaultSessionMeta(), messages: [], hasMore: false, ...IDLE_STREAM };
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...base, ...partial },
          },
        };
      });
    },

    initSessionSnapshot: (sessionKey, snapshot) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => ({
        sessions: { ...state.sessions, [key]: cloneSlice(snapshot) },
      }));
    },

    setCommittedSnapshot: (sessionKey, data) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        const hasMore = data.hasMore;
        const messages = cloneMessages(data.messages);
        const meta = metaFrom(current);
        if (data.name !== undefined) {
          meta.name = data.name;
        }
        if (!current) {
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...meta, messages, hasMore, ...IDLE_STREAM },
            },
          };
        }
        if (isSessionSliceLive(current)) {
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...current, ...meta, hasMore },
            },
          };
        }
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...current, ...meta, messages, hasMore, ...IDLE_STREAM },
          },
        };
      });
    },

    updateSessionMessages: (sessionKey, updater) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...current, messages: cloneMessages(updater(current.messages)) },
          },
        };
      });
    },

    finalizeStreamingTurn: (sessionKey, messages) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        const meta = metaFrom(current);
        const hasMore = current?.hasMore ?? false;
        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...meta,
              messages: cloneMessages(messages),
              hasMore,
              ...IDLE_STREAM,
            },
          },
        };
      });
    },

    clearStreamingState: (sessionKey) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...current, ...IDLE_STREAM },
          },
        };
      });
    },

    clearSession: (sessionKey) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        if (!(key in state.sessions)) return state;
        const { [key]: _removed, ...rest } = state.sessions;
        return { sessions: rest };
      });
    },

    getSessionSnapshot: (sessionKey) => {
      const key = normalizeKey(sessionKey);
      if (!key) return undefined;
      const slice = get().sessions[key];
      return slice ? cloneSlice(slice) : undefined;
    },

    seedSessionIfEmpty: (sessionKey, messages, sending, streaming, hasMore = false) => {
      const key = normalizeKey(sessionKey);
      if (!key || get().sessions[key]) return;
      get().initSessionSnapshot(key, {
        ...defaultSessionMeta(),
        messages,
        hasMore,
        streamingMsg: null,
        progress: null,
        sending,
        streaming,
      });
    },

    setSessionFlags: (sessionKey, partial) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;
        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              ...(partial.sending !== undefined ? { sending: partial.sending } : {}),
              ...(partial.streaming !== undefined ? { streaming: partial.streaming } : {}),
            },
          },
        };
      });
    },

    setSessionProgress: (sessionKey, progress) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...current, progress },
          },
        };
      });
    },

    mutateSessionStreaming: (sessionKey, mutator, timestamp = Date.now()) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;
        const shell = ensureAssistantMessage(current.streamingMsg, timestamp);
        mutator(shell);
        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              streamingMsg: cloneMessageForRender(shell),
              streaming: true,
            },
          },
        };
      });
    },

    applyHydratedTail: (sessionKey, messagesWithoutTail, tail) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;
        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              messages: cloneMessages(messagesWithoutTail),
              streamingMsg: tail ? cloneMessageForRender(tail) : null,
              streaming: true,
              sending: true,
            },
          },
        };
      });
    },

    appendUserMessageIfMissing: (sessionKey, message) => {
      const key = normalizeKey(sessionKey);
      if (!key || !isUiUserMessage(message.role)) return;
      set((state) => {
        const current = state.sessions[key];
        const meta = metaFrom(current);
        if (!current) {
          return {
            sessions: {
              ...state.sessions,
              [key]: {
                ...meta,
                messages: cloneMessages([message]),
                hasMore: false,
                ...IDLE_STREAM,
              },
            },
          };
        }
        const last = current.messages[current.messages.length - 1];
        if (last && shouldReplaceOptimisticUserRow(last, message)) {
          return {
            sessions: {
              ...state.sessions,
              [key]: {
                ...current,
                messages: cloneMessages(
                  mergeConsecutiveAssistantMessages([...current.messages.slice(0, -1), message]),
                ),
              },
            },
          };
        }
        const hasDup = current.messages.some((m) => userMessagesEquivalent(m, message));
        if (hasDup) return state;
        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              messages: cloneMessages(
                mergeConsecutiveAssistantMessages([...current.messages, message]),
              ),
            },
          },
        };
      });
    },

    mergeCommittedFromServer: (sessionKey, serverMessages, hasMore) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        const meta = metaFrom(current);
        const nextHasMore = hasMore ?? current?.hasMore ?? false;
        if (!current) {
          return {
            sessions: {
              ...state.sessions,
              [key]: {
                ...meta,
                messages: cloneMessages(serverMessages),
                hasMore: nextHasMore,
                ...IDLE_STREAM,
              },
            },
          };
        }
        if (!isSessionSliceLive(current)) {
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...meta, messages: cloneMessages(serverMessages), hasMore: nextHasMore, ...IDLE_STREAM },
            },
          };
        }
        const merged = mergeMissingUserMessagesFromServer(current.messages, serverMessages);
        if (merged === current.messages && nextHasMore === current.hasMore) {
          return state;
        }
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...current, messages: cloneMessages(merged), hasMore: nextHasMore },
          },
        };
      });
    },

    prependHistoryMessages: (sessionKey, older, hasMore) => {
      const key = normalizeKey(sessionKey);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        const meta = metaFrom(current);
        if (!current) {
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...meta, messages: cloneMessages(older), hasMore, ...IDLE_STREAM },
            },
          };
        }
        const existing = new Set(current.messages.map((m) => m.timestamp));
        const prepended = older.filter((m) => !existing.has(m.timestamp));
        const merged = mergeConsecutiveAssistantMessages([...prepended, ...current.messages]);
        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              messages: cloneMessages(merged),
              hasMore,
            },
          },
        };
      });
    },
  }),
);

/** True when a slice has an active or resumable in-flight turn. */
export function isSessionSliceLive(slice: ChatSessionSlice | undefined): boolean {
  if (!slice) return false;
  return slice.streaming || slice.sending || Boolean(slice.streamingMsg);
}

/** Imperative snapshot read for SSE callbacks and resume paths. */
export function getChatSessionSnapshot(sessionKey: string): ChatSessionSlice | undefined {
  return useChatSessionStore.getState().getSessionSnapshot(sessionKey);
}

/** Committed messages for a session (empty when not loaded). */
export function getSessionMessages(sessionKey: string): Message[] {
  return useChatSessionStore.getState().sessions[normalizeKey(sessionKey)]?.messages ?? [];
}

/** Sidebar / background run indicator (store slice, HTTP SSE, or pending run id). */
export function isSessionAgentRunActive(sessionKey: string): boolean {
  const key = normalizeKey(sessionKey);
  if (!key) return false;
  const slice = useChatSessionStore.getState().sessions[key];
  if (isSessionSliceLive(slice)) return true;
  if (chatRunManager.isStreamingFor(key)) return true;
  return hasPendingAgentRunForChat(key);
}
