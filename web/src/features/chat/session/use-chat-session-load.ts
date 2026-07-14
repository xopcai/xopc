import { useCallback, useRef, type RefObject } from 'react';

import { DEFAULT_THINKING } from '@/features/chat/session/chat-session-defaults';
import type { SessionInfo } from '@/features/chat/chat.types';
import { type Message, coerceReasoningLevel } from '@/features/chat/messages/messages.types';
import { modelSupportsReasoning } from '@/features/chat/model/model-capabilities';
import { hasPendingAgentRunForChat } from '@/features/chat/messages/message-sender';
import { isViewingSession, resolveViewSessionKey } from '@/features/chat/session/chat-session-view';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { openNewChatHandoff } from '@/features/chat/session/new-chat-handoff';
import type { SessionManager } from '@/features/chat/session/session-manager';

export function useChatSessionLoad(deps: {
  sessionMgrRef: RefObject<SessionManager>;
  routeSessionKeyRef: RefObject<string | null>;
  sendingRef: RefObject<boolean>;
  streamingRef: RefObject<boolean>;
  activeStreamSessionKeyRef: RefObject<string | null>;
  loadingSessionRef: RefObject<boolean>;
  messagesLenRef: RefObject<number>;
  thinkingSupportGenRef: RefObject<number>;

  navigateToSession: (key: string, replace?: boolean, search?: string) => void;
  resolveAgentIdForPost: () => string | undefined;
  dismissClarifyOnSessionLoad: () => void;
  detachForNewConversation: () => void;

  sessionKey: string | null;
  hasMore: boolean;
}) {
  const {
    sessionMgrRef,
    routeSessionKeyRef,
    sendingRef,
    streamingRef,
    activeStreamSessionKeyRef,
    loadingSessionRef,
    messagesLenRef,
    thinkingSupportGenRef,
    navigateToSession,
    resolveAgentIdForPost,
    dismissClarifyOnSessionLoad,
    detachForNewConversation,
    sessionKey,
    hasMore,
  } = deps;

  const store = () => useChatSessionStore.getState();

  const loadTailRef = useRef(Promise.resolve<void>(undefined));
  const historyBeforeCursorRef = useRef<string | null>(null);
  const sessionNamePollGenRef = useRef(0);

  const refreshModelThinkingSupport = useCallback((modelId: string): Promise<void> => {
    const key = store().focusedSessionKey;
    if (!modelId.trim()) {
      const gen = ++thinkingSupportGenRef.current;
      if (gen === thinkingSupportGenRef.current && key) {
        store().patchSessionMeta(key, { modelSupportsThinking: false });
      }
      return Promise.resolve();
    }
    const gen = ++thinkingSupportGenRef.current;
    return modelSupportsReasoning(modelId).then((supports) => {
      if (gen !== thinkingSupportGenRef.current) return;
      const focused = store().focusedSessionKey;
      if (focused) store().patchSessionMeta(focused, { modelSupportsThinking: supports });
    });
  }, [thinkingSupportGenRef]);

  const applySessionAgentConfig = useCallback(
    async (key: string) => {
      try {
        const cfg = await sessionMgrRef.current.loadSessionAgentConfig(key);
        store().patchSessionMeta(key, {
          model: cfg.model,
          thinkingLevel: cfg.thinkingLevel || DEFAULT_THINKING,
          reasoningLevel: coerceReasoningLevel(cfg.reasoningLevel),
          workingDirectoryLocked: cfg.workingDirectoryLocked,
        });
        void refreshModelThinkingSupport(cfg.model);
      } catch {
        /* ignore */
      }
    },
    [sessionMgrRef, refreshModelThinkingSupport],
  );

  const pollSessionNameAfterTurn = useCallback(() => {
    const key = store().focusedSessionKey;
    if (!key) return;
    const existingName = store().sessions[key]?.name;
    if (existingName?.trim()) return;

    const gen = ++sessionNamePollGenRef.current;
    const maxAttempts = 5;
    const delaysMs = [700, 900, 900, 1000, 1000];

    const pollAttempt = (attempt: number): void => {
      if (attempt >= maxAttempts) return;
      if (gen !== sessionNamePollGenRef.current) return;
      if (store().focusedSessionKey !== key) return;
      if (store().sessions[key]?.name?.trim()) return;
      window.setTimeout(() => {
        if (gen !== sessionNamePollGenRef.current) return;
        if (store().focusedSessionKey !== key) return;
        if (store().sessions[key]?.name?.trim()) return;
        void sessionMgrRef.current
          .fetchSessionName(key)
          .then((name) => {
            if (gen !== sessionNamePollGenRef.current) return;
            if (name) {
              store().patchSessionMeta(key, { name });
              return;
            }
            pollAttempt(attempt + 1);
          })
          .catch(() => {
            pollAttempt(attempt + 1);
          });
      }, delaysMs[attempt] ?? 900);
    };

    pollAttempt(0);
  }, [sessionMgrRef]);

  const isStillViewingSession = useCallback(
    (chatId: string) =>
      isViewingSession({
        chatId,
        routeSessionKey: routeSessionKeyRef.current,
      }),
    [routeSessionKeyRef],
  );

  const applyLoadedSessionSnapshot = useCallback(
    (chatId: string, data: { messages: Message[]; hasMore: boolean; name?: string; nextBeforeCursor?: string }) => {
      const snap = store().getSessionSnapshot(chatId);
      if (snap && (snap.streaming || snap.sending || snap.streamingMsg)) {
        store().mergeCommittedFromServer(chatId, data.messages, data.hasMore);
        if (data.name !== undefined) {
          store().patchSessionMeta(chatId, { name: data.name || null });
        }
      } else {
        store().setCommittedSnapshot(chatId, {
          messages: data.messages,
          hasMore: data.hasMore,
          name: data.name,
        });
      }
      if (!isStillViewingSession(chatId)) {
        return;
      }
      historyBeforeCursorRef.current = data.nextBeforeCursor ?? null;
    },
    [isStillViewingSession],
  );

  const loadSessionById = useCallback(
    async (key: string, offset = 0, beforeCursor?: string | null): Promise<Message[] | undefined> => {
      const runBody = async (
        k: string,
        o: number,
        cursor?: string | null,
      ): Promise<Message[] | undefined> => {
        const initialLoad = o === 0 && !cursor;
        if (initialLoad && !hasPendingAgentRunForChat(k)) {
          dismissClarifyOnSessionLoad();
        }
        loadingSessionRef.current = true;
        if (initialLoad) {
          store().setSessionHistoryStatus(k, 'loading');
        }
        try {
          const {
            messages: loaded,
            hasMore: more,
            name,
            nextBeforeCursor,
          } = await sessionMgrRef.current.loadSession(k, o, cursor);
          if (initialLoad) {
            store().setCommittedSnapshot(k, { messages: loaded, hasMore: more, name: name ?? null });
            if (!isStillViewingSession(k)) {
              return loaded;
            }
            historyBeforeCursorRef.current = nextBeforeCursor ?? null;
            store().setShellError(null);
            try {
              const cfg = await sessionMgrRef.current.loadSessionAgentConfig(k);
              if (!isStillViewingSession(k)) return loaded;
              store().patchSessionMeta(k, {
                model: cfg.model,
                thinkingLevel: cfg.thinkingLevel || DEFAULT_THINKING,
                reasoningLevel: coerceReasoningLevel(cfg.reasoningLevel),
                workingDirectoryLocked: cfg.workingDirectoryLocked,
              });
              void refreshModelThinkingSupport(cfg.model);
            } catch {
              /* gateway may be older */
            }
            return loaded;
          }
          historyBeforeCursorRef.current = nextBeforeCursor ?? null;
          if (!isStillViewingSession(k)) {
            return undefined;
          }
          store().prependHistoryMessages(k, loaded, more);
          return undefined;
        } catch {
          if (o === 0 && !cursor) {
            historyBeforeCursorRef.current = null;
            store().setShellError('Failed to load session');
            const routedViewKey = resolveViewSessionKey(routeSessionKeyRef.current);
            if (routedViewKey && routedViewKey === k) {
              return undefined;
            }
            const sessions = await sessionMgrRef.current.loadSessions().catch(() => [] as SessionInfo[]);
            const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
            const target = withMsgs[0] ?? sessions[0];
            if (target) {
              navigateToSession(target.key, true);
              return await runBody(target.key, 0, null);
            } else {
              historyBeforeCursorRef.current = null;
              const aid = resolveAgentIdForPost();
              void openNewChatHandoff({
                sessionMgr: sessionMgrRef.current,
                agentId: aid,
                currentSessionKey: null,
                routeSessionKey: null,
                navigateToSession,
                replaceNavigate: true,
                onOpened: (key) => {
                  store().setCommittedSnapshot(key, { messages: [], hasMore: false, name: null });
                  void applySessionAgentConfig(key);
                },
              });
            }
          }
          return undefined;
        } finally {
          loadingSessionRef.current = false;
          if (initialLoad && store().sessions[k]?.historyStatus === 'loading') {
            store().setSessionHistoryStatus(k, 'ready');
          }
        }
      };

      const prev = loadTailRef.current;
      let releaseTail!: () => void;
      const tailGate = new Promise<void>((r) => {
        releaseTail = r;
      });
      loadTailRef.current = prev.then(() => tailGate);
      await prev;
      try {
        return await runBody(key, offset, beforeCursor);
      } finally {
        releaseTail();
      }
    },
    [
      routeSessionKeyRef,
      isStillViewingSession,
      sendingRef,
      streamingRef,
      activeStreamSessionKeyRef,
      loadingSessionRef,
      dismissClarifyOnSessionLoad,
      navigateToSession,
      refreshModelThinkingSupport,
      resolveAgentIdForPost,
      sessionMgrRef,
    ],
  );

  const loadMoreMessages = useCallback(async () => {
    const key = store().focusedSessionKey;
    if (!key || store().loadingMore || !hasMore) return;
    store().setLoadingMore(true);
    try {
      await loadSessionById(key, messagesLenRef.current, historyBeforeCursorRef.current);
    } finally {
      store().setLoadingMore(false);
    }
  }, [hasMore, loadSessionById, messagesLenRef]);

  const onSessionModelChange = useCallback(
    async (modelId: string) => {
      if (!sessionKey) return;
      try {
        store().setShellError(null);
        await sessionMgrRef.current.patchSessionAgentConfig(sessionKey, { model: modelId });
        store().patchSessionMeta(sessionKey, { model: modelId });
        void refreshModelThinkingSupport(modelId);
      } catch (e) {
        store().setShellError(e instanceof Error ? e.message : 'Failed to switch model');
      }
    },
    [sessionKey, sessionMgrRef, refreshModelThinkingSupport],
  );

  const onSessionThinkingLevelChange = useCallback(
    async (level: string) => {
      if (!sessionKey) return;
      try {
        store().setShellError(null);
        await sessionMgrRef.current.patchSessionAgentConfig(sessionKey, { thinkingLevel: level });
        store().patchSessionMeta(sessionKey, { thinkingLevel: level });
      } catch (e) {
        store().setShellError(e instanceof Error ? e.message : 'Failed to update thinking level');
      }
    },
    [sessionKey, sessionMgrRef],
  );

  const createNewSession = useCallback(
    async (opts?: { forceNew?: boolean }) => {
      dismissClarifyOnSessionLoad();
      detachForNewConversation();
      historyBeforeCursorRef.current = null;
      store().setShellError(null);
      const aid = resolveAgentIdForPost();
      await openNewChatHandoff({
        sessionMgr: sessionMgrRef.current,
        agentId: aid,
        currentSessionKey: sessionKey,
        routeSessionKey: sessionKey,
        forceNew: opts?.forceNew,
        navigateToSession,
        onOpened: (key) => {
          store().setCommittedSnapshot(key, { messages: [], hasMore: false, name: null });
          void applySessionAgentConfig(key);
        },
      });
    },
    [
      dismissClarifyOnSessionLoad,
      detachForNewConversation,
      navigateToSession,
      resolveAgentIdForPost,
      sessionKey,
      sessionMgrRef,
      applySessionAgentConfig,
    ],
  );

  return {
    refreshModelThinkingSupport,
    pollSessionNameAfterTurn,
    applyLoadedSessionSnapshot,
    loadSessionById,
    loadMoreMessages,
    onSessionModelChange,
    onSessionThinkingLevelChange,
    createNewSession,
  };
}
