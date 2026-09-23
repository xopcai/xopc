import { create } from 'zustand';

import type {
  Message,
  MessageAttachment,
  ProgressState,
  ReasoningLevel,
} from '@/features/chat/messages/messages.types';
import { hasPendingAgentRunForChat } from '@/features/chat/messages/message-sender';
import type { TaskPlanState } from '@/features/chat/messages/message-sender';
import {
  assistantTurnVisuallyEquivalent,
  mergeConsecutiveAssistantMessages,
} from '@/features/chat/messages/agent-messages';
import { mergeMissingUserMessagesFromServer } from '@/features/chat/messages/merge-missing-user-messages';
import {
  shouldReplaceOptimisticUserRow,
  userMessagesEquivalent,
} from '@/features/chat/messages/user-message-from-stream';
import { isUiUserMessage } from '@/features/chat/messages/user-round-index';
import { defaultSessionMeta } from '@/features/chat/session/chat-session-defaults';
import { chatRunManager } from '@/features/chat/session/chat-run-manager';
import { cloneMessageForRender, ensureAssistantMessage } from '@/features/chat/messages/streaming';

/** Per-session chat UI and agent config. @see docs/web/chat-session-semantics.md */
export type SessionHistoryStatus = 'unknown' | 'loading' | 'ready';

export function shouldShowHistoryLoading(status: SessionHistoryStatus | undefined): boolean {
  return status !== 'ready';
}

export type ChatSessionSlice = {
  name: string | null;
  model: string;
  configVersion?: number;
  modelConfigSaving?: boolean;
  thinkingLevel: string;
  reasoningLevel: ReasoningLevel;
  modelSupportsThinking: boolean;
  effectiveWorkspacePath: string;
  workspaceSource: 'execution_environment' | 'project' | 'session_override' | 'agent_default_root' | 'agent_workspace';
  userContextMode: 'enabled' | 'off' | 'temporary';
  historyStatus: SessionHistoryStatus;
  messages: Message[];
  hasMore: boolean;
  streamingMsg: Message | null;
  progress: ProgressState | null;
  taskPlan: TaskPlanState | null;
  sending: boolean;
  streaming: boolean;
};

type ChatSessionStoreState = {
  focusedConversationId: string | null;
  initLoading: boolean;
  loadingMore: boolean;
  shellError: string | null;
  sessions: Record<string, ChatSessionSlice>;
};

type ChatSessionStoreActions = {
  setFocusedConversationId: (key: string | null) => void;
  setInitLoading: (loading: boolean) => void;
  setLoadingMore: (loading: boolean) => void;
  setShellError: (error: string | null) => void;
  setSessionHistoryStatus: (conversationId: string, status: SessionHistoryStatus) => void;
  patchSessionMeta: (
    conversationId: string,
    partial: Partial<
      Pick<
        ChatSessionSlice,
        | 'name'
        | 'model'
        | 'configVersion'
        | 'modelConfigSaving'
        | 'thinkingLevel'
        | 'reasoningLevel'
        | 'modelSupportsThinking'
        | 'effectiveWorkspacePath'
        | 'workspaceSource'
        | 'userContextMode'
      >
    >,
  ) => void;
  initSessionSnapshot: (conversationId: string, snapshot: ChatSessionSlice) => void;
  setCommittedSnapshot: (
    conversationId: string,
    data: { messages: Message[]; hasMore: boolean; name?: string | null },
  ) => void;
  updateSessionMessages: (
    conversationId: string,
    updater: (prev: Message[]) => Message[],
  ) => void;
  finalizeStreamingTurn: (conversationId: string, message: Message) => void;
  completeProgressiveRender: (conversationId: string, renderKey: string) => void;
  clearStreamingState: (conversationId: string) => void;
  clearSession: (conversationId: string) => void;
  getSessionSnapshot: (conversationId: string) => ChatSessionSlice | undefined;
  seedSessionIfEmpty: (
    conversationId: string,
    messages: Message[],
    sending: boolean,
    streaming: boolean,
    hasMore?: boolean,
  ) => void;
  setSessionFlags: (
    conversationId: string,
    partial: Partial<Pick<ChatSessionSlice, 'sending' | 'streaming'>>,
  ) => void;
  setSessionProgress: (conversationId: string, progress: ProgressState | null) => void;
  setSessionTaskPlan: (conversationId: string, taskPlan: TaskPlanState) => void;
  mutateSessionStreaming: (
    conversationId: string,
    mutator: (msg: Message) => void,
    timestamp?: number,
  ) => void;
  appendAttachmentToCurrentAssistant: (
    conversationId: string,
    attachment: MessageAttachment,
    target?: { messageId?: string; attachTo?: 'last_assistant' },
  ) => void;
  applyHydratedTail: (
    conversationId: string,
    messagesWithoutTail: Message[],
    tail: Message | null,
  ) => void;
  prependHistoryMessages: (conversationId: string, older: Message[], hasMore: boolean) => void;
  appendUserMessageIfMissing: (conversationId: string, message: Message) => void;
  mergeCommittedFromServer: (
    conversationId: string,
    serverMessages: Message[],
    hasMore?: boolean,
  ) => void;
};

const IDLE_STREAM: Pick<
  ChatSessionSlice,
  'streamingMsg' | 'progress' | 'taskPlan' | 'sending' | 'streaming'
> = {
  streamingMsg: null,
  progress: null,
  taskPlan: null,
  sending: false,
  streaming: false,
};

function createEmptySessionSlice(historyStatus: SessionHistoryStatus): ChatSessionSlice {
  return {
    ...defaultSessionMeta(),
    historyStatus,
    messages: [],
    hasMore: false,
    ...IDLE_STREAM,
  };
}

let nextMessageRenderKey = 0;

function cloneSessionMessage(message: Message): Message {
  const next = cloneMessageForRender(message);
  next.renderKey ??= `chat-row:${++nextMessageRenderKey}`;
  return next;
}

function cloneMessages(messages: Message[]): Message[] {
  return messages.map(cloneSessionMessage);
}

function messagesEqualForRender(left: Message, right: Message): boolean {
  if (left === right) return true;
  if (left.role !== right.role || left.timestamp !== right.timestamp) return false;
  if (right.renderKey !== undefined && left.renderKey !== right.renderKey) return false;
  // Server snapshots do not carry the client-only row identity.
  return JSON.stringify({ ...left, renderKey: undefined }) === JSON.stringify({ ...right, renderKey: undefined });
}

function preserveLocalUserDisplayPayload(existing: Message, incoming: Message): Message {
  if (existing.turnId && incoming.turnId && existing.turnId !== incoming.turnId) return incoming;
  if (!userMessagesEquivalent(existing, incoming)) return incoming;
  const attachments = incoming.attachments?.length ? incoming.attachments : existing.attachments;
  const contextRefs = incoming.contextRefs?.length ? incoming.contextRefs : existing.contextRefs;
  const userTurnDocument = incoming.userTurnDocument ?? existing.userTurnDocument;
  if (attachments === incoming.attachments && contextRefs === incoming.contextRefs
    && userTurnDocument === incoming.userTurnDocument) return incoming;
  return { ...incoming, attachments, contextRefs, userTurnDocument };
}

/** Keep row identities stable when a background history refresh returns unchanged data. */
function reconcileMessages(current: Message[], incoming: Message[]): Message[] {
  let changed = current.length !== incoming.length;
  const next = incoming.map((incomingMessage, index) => {
    const existing = current[index];
    const message = existing && isUiUserMessage(existing.role) && isUiUserMessage(incomingMessage.role)
      ? preserveLocalUserDisplayPayload(existing, incomingMessage)
      : incomingMessage;
    if (existing && messagesEqualForRender(existing, message)) {
      return existing;
    }
    changed = true;
    const nextMessage = cloneSessionMessage(message);
    if (
      existing?.renderKey
      && existing.role === message.role
      && (
        (!message.renderKey && existing.timestamp === message.timestamp && existing.turnId === message.turnId)
        || (message.role === 'assistant' && assistantTurnVisuallyEquivalent(existing, message))
      )
    ) {
      nextMessage.renderKey = existing.renderKey;
    }
    return nextMessage;
  });
  return changed ? next : current;
}

function preserveFailedOptimisticMessages(current: Message[], incoming: Message[]): Message[] {
  const failed = current.filter((message) => message.deliveryStatus === 'failed');
  if (failed.length === 0) return incoming;
  const knownLocalUserCount = current.filter(
    (message) => isUiUserMessage(message.role) && message.deliveryStatus !== 'failed',
  ).length;
  const unmatchedServerUsers = incoming
    .filter((message) => isUiUserMessage(message.role))
    .slice(knownLocalUserCount);
  const missing = failed.filter((message) => {
    const matchIndex = unmatchedServerUsers.findIndex(
      (serverMessage) => shouldReplaceOptimisticUserRow(message, serverMessage),
    );
    if (matchIndex < 0) return true;
    unmatchedServerUsers.splice(matchIndex, 1);
    return false;
  });
  return missing.length > 0 ? [...incoming, ...missing] : incoming;
}

function appendFinalAssistantMessage(current: Message[], message: Message): Message[] {
  const finalMessage = cloneMessageForRender(message);
  const last = current[current.length - 1];
  if (last?.role !== 'assistant') {
    return [...current, cloneSessionMessage(finalMessage)];
  }
  const mergedTail = mergeConsecutiveAssistantMessages([last, finalMessage]);
  return [...current.slice(0, -1), ...mergedTail];
}

function attachmentKey(att: MessageAttachment): string {
  const uri = att.uri?.trim();
  if (uri) return `uri:${uri}`;
  if (att.id) return `id:${att.id}`;
  return `name:${att.name ?? 'file'}|${att.mimeType ?? ''}`;
}

function appendAttachmentDeduped(
  attachments: MessageAttachment[] | undefined,
  attachment: MessageAttachment,
): MessageAttachment[] {
  const next = [...(attachments ?? [])];
  const key = attachmentKey(attachment);
  if (!next.some((att) => attachmentKey(att) === key)) {
    next.push({ ...attachment });
  }
  return next;
}

function cloneSlice(slice: ChatSessionSlice): ChatSessionSlice {
  return {
    name: slice.name,
    model: slice.model,
    configVersion: slice.configVersion,
    modelConfigSaving: slice.modelConfigSaving,
    thinkingLevel: slice.thinkingLevel,
    reasoningLevel: slice.reasoningLevel,
    modelSupportsThinking: slice.modelSupportsThinking,
    effectiveWorkspacePath: slice.effectiveWorkspacePath,
    workspaceSource: slice.workspaceSource,
    userContextMode: slice.userContextMode,
    historyStatus: slice.historyStatus,
    messages: cloneMessages(slice.messages),
    hasMore: slice.hasMore,
    streamingMsg: slice.streamingMsg ? cloneSessionMessage(slice.streamingMsg) : null,
    progress: slice.progress,
    taskPlan: slice.taskPlan
      ? { ...slice.taskPlan, items: slice.taskPlan.items.map((item) => ({ ...item })) }
      : null,
    sending: slice.sending,
    streaming: slice.streaming,
  };
}

function normalizeKey(conversationId: string): string {
  return String(conversationId ?? '').trim();
}

function metaFrom(current: ChatSessionSlice | undefined): Pick<
  ChatSessionSlice,
  | 'name'
  | 'model'
        | 'configVersion'
        | 'modelConfigSaving'
  | 'thinkingLevel'
  | 'reasoningLevel'
  | 'modelSupportsThinking'
  | 'effectiveWorkspacePath'
  | 'workspaceSource'
  | 'userContextMode'
> {
  if (!current) return defaultSessionMeta();
  return {
    name: current.name,
    model: current.model,
    configVersion: current.configVersion,
    modelConfigSaving: current.modelConfigSaving,
    thinkingLevel: current.thinkingLevel,
    reasoningLevel: current.reasoningLevel,
    modelSupportsThinking: current.modelSupportsThinking,
    effectiveWorkspacePath: current.effectiveWorkspacePath,
    workspaceSource: current.workspaceSource,
    userContextMode: current.userContextMode,
  };
}

export const useChatSessionStore = create<ChatSessionStoreState & ChatSessionStoreActions>(
  (set, get) => ({
    focusedConversationId: null,
    initLoading: true,
    loadingMore: false,
    shellError: null,
    sessions: {},

    setFocusedConversationId: (key) => set({ focusedConversationId: key }),
    setInitLoading: (loading) => set({ initLoading: loading }),
    setLoadingMore: (loading) => set({ loadingMore: loading }),
    setShellError: (error) => set({ shellError: error }),

    setSessionHistoryStatus: (conversationId, historyStatus) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (current?.historyStatus === historyStatus) return state;
        const base = current ?? createEmptySessionSlice('unknown');
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...base, historyStatus },
          },
        };
      });
    },

    patchSessionMeta: (conversationId, partial) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        const base = current ?? createEmptySessionSlice('unknown');
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...base, ...partial },
          },
        };
      });
    },

    initSessionSnapshot: (conversationId, snapshot) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => ({
        sessions: { ...state.sessions, [key]: cloneSlice(snapshot) },
      }));
    },

    setCommittedSnapshot: (conversationId, data) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        const hasMore = data.hasMore;
        const meta = metaFrom(current);
        if (data.name !== undefined) {
          meta.name = data.name;
        }
        if (!current) {
          const messages = cloneMessages(data.messages);
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...meta, historyStatus: 'ready', messages, hasMore, ...IDLE_STREAM },
            },
          };
        }
        if (isSessionSliceLive(current)) {
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...current, ...meta, historyStatus: 'ready', hasMore },
            },
          };
        }
        const messages = reconcileMessages(
          current.messages,
          preserveFailedOptimisticMessages(current.messages, data.messages),
        );
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...current, ...meta, historyStatus: 'ready', messages, hasMore, ...IDLE_STREAM },
          },
        };
      });
    },

    updateSessionMessages: (conversationId, updater) => {
      const key = normalizeKey(conversationId);
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

    finalizeStreamingTurn: (conversationId, message) => {
      const key = normalizeKey(conversationId);
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
              historyStatus: 'ready',
              messages: appendFinalAssistantMessage(current?.messages ?? [], message),
              hasMore,
              ...IDLE_STREAM,
            },
          },
        };
      });
    },

    completeProgressiveRender: (conversationId, renderKey) => {
      const key = normalizeKey(conversationId);
      if (!key || !renderKey) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;
        let changed = false;
        const clearHint = (message: Message): Message => {
          if (message.renderKey !== renderKey || !message.progressiveRender) return message;
          changed = true;
          const next = cloneMessageForRender(message);
          delete next.progressiveRender;
          return next;
        };
        const messages = current.messages.map(clearHint);
        const streamingMsg = current.streamingMsg ? clearHint(current.streamingMsg) : null;
        if (!changed) return state;
        return {
          sessions: {
            ...state.sessions,
            [key]: { ...current, messages, streamingMsg },
          },
        };
      });
    },

    clearStreamingState: (conversationId) => {
      const key = normalizeKey(conversationId);
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

    clearSession: (conversationId) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => {
        if (!(key in state.sessions)) return state;
        const { [key]: _removed, ...rest } = state.sessions;
        return { sessions: rest };
      });
    },

    getSessionSnapshot: (conversationId) => {
      const key = normalizeKey(conversationId);
      if (!key) return undefined;
      const slice = get().sessions[key];
      return slice ? cloneSlice(slice) : undefined;
    },

    seedSessionIfEmpty: (conversationId, messages, sending, streaming, hasMore = false) => {
      const key = normalizeKey(conversationId);
      if (!key || get().sessions[key]) return;
      get().initSessionSnapshot(key, {
        ...defaultSessionMeta(),
        historyStatus: 'ready',
        messages,
        hasMore,
        streamingMsg: null,
        progress: null,
        taskPlan: null,
        sending,
        streaming,
      });
    },

    setSessionFlags: (conversationId, partial) => {
      const key = normalizeKey(conversationId);
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

    setSessionProgress: (conversationId, progress) => {
      const key = normalizeKey(conversationId);
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

    setSessionTaskPlan: (conversationId, taskPlan) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current || taskPlan.revision <= (current.taskPlan?.revision ?? 0)) return state;
        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              taskPlan: {
                ...taskPlan,
                items: taskPlan.items.map((item) => ({ ...item })),
              },
            },
          },
        };
      });
    },

    mutateSessionStreaming: (conversationId, mutator, timestamp = Date.now()) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;
        const shell = ensureAssistantMessage(current.streamingMsg, timestamp);
        shell.renderKey ??= `assistant-stream:${key}:${timestamp}`;
        shell.progressiveRender = true;
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

    appendAttachmentToCurrentAssistant: (conversationId, attachment, _target) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        if (!current) return state;

        if (current.streamingMsg?.role === 'assistant') {
          const streamingMsg = cloneMessageForRender(current.streamingMsg);
          streamingMsg.attachments = appendAttachmentDeduped(streamingMsg.attachments, attachment);
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...current, streamingMsg },
            },
          };
        }

        const messages = cloneMessages(current.messages);
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg?.role !== 'assistant') continue;
          messages[i] = {
            ...msg,
            attachments: appendAttachmentDeduped(msg.attachments, attachment),
          };
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...current, messages },
            },
          };
        }

        return state;
      });
    },

    applyHydratedTail: (conversationId, messagesWithoutTail, tail) => {
      const key = normalizeKey(conversationId);
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

    appendUserMessageIfMissing: (conversationId, message) => {
      const key = normalizeKey(conversationId);
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
                historyStatus: 'ready',
                messages: cloneMessages([message]),
                hasMore: false,
                ...IDLE_STREAM,
              },
            },
          };
        }
        const last = current.messages[current.messages.length - 1];
        if (last && shouldReplaceOptimisticUserRow(last, message)) {
          const replacement = {
            ...message,
            ...(!message.contextRefs?.length && last.contextRefs?.length
              ? { contextRefs: last.contextRefs }
              : {}),
            ...(!message.userTurnDocument && last.userTurnDocument
              ? { userTurnDocument: last.userTurnDocument }
              : {}),
          };
          return {
            sessions: {
              ...state.sessions,
              [key]: {
                ...current,
                messages: cloneMessages(
                  mergeConsecutiveAssistantMessages([...current.messages.slice(0, -1), replacement]),
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

    mergeCommittedFromServer: (conversationId, serverMessages, hasMore) => {
      const key = normalizeKey(conversationId);
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
                historyStatus: 'ready',
                messages: cloneMessages(serverMessages),
                hasMore: nextHasMore,
                ...IDLE_STREAM,
              },
            },
          };
        }
        if (!isSessionSliceLive(current)) {
          const messages = preserveFailedOptimisticMessages(current.messages, serverMessages);
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...meta, historyStatus: 'ready', messages: cloneMessages(messages), hasMore: nextHasMore, ...IDLE_STREAM },
            },
          };
        }
        const merged = mergeMissingUserMessagesFromServer(
          current.messages,
          serverMessages,
          current.streamingMsg?.turnId,
        );
        if (
          merged === current.messages &&
          nextHasMore === current.hasMore &&
          current.historyStatus === 'ready'
        ) {
          return state;
        }
        return {
          sessions: {
            ...state.sessions,
            [key]: {
              ...current,
              historyStatus: 'ready',
              messages: cloneMessages(merged),
              hasMore: nextHasMore,
            },
          },
        };
      });
    },

    prependHistoryMessages: (conversationId, older, hasMore) => {
      const key = normalizeKey(conversationId);
      if (!key) return;
      set((state) => {
        const current = state.sessions[key];
        const meta = metaFrom(current);
        if (!current) {
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...meta, historyStatus: 'ready', messages: cloneMessages(older), hasMore, ...IDLE_STREAM },
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

/** Imperative snapshot read for run callbacks and resume paths. */
export function getChatSessionSnapshot(conversationId: string): ChatSessionSlice | undefined {
  return useChatSessionStore.getState().getSessionSnapshot(conversationId);
}

/** Committed messages for a session (empty when not loaded). */
export function getSessionMessages(conversationId: string): Message[] {
  return useChatSessionStore.getState().sessions[normalizeKey(conversationId)]?.messages ?? [];
}

/** Sidebar / background run indicator (store slice, realtime run, or pending run id). */
export function isSessionAgentRunActive(conversationId: string): boolean {
  const key = normalizeKey(conversationId);
  if (!key) return false;
  const slice = useChatSessionStore.getState().sessions[key];
  if (isSessionSliceLive(slice)) return true;
  if (chatRunManager.isStreamingFor(key)) return true;
  return hasPendingAgentRunForChat(key);
}
