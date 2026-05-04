import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { mergeConsecutiveAssistantMessages } from '@/features/chat/agent-messages';
import {
  DEFAULT_THINKING,
  pickEmptyWebSessionForAgent,
} from '@/features/chat/chat-session-defaults';
import type { SessionInfo } from '@/features/chat/chat.types';
import {
  coerceReasoningLevel,
  type Message,
  type ReasoningLevel,
} from '@/features/chat/messages.types';
import { modelSupportsReasoning } from '@/features/chat/model-capabilities';
import type { SessionManager } from '@/features/chat/session-manager';

export function useChatSessionLoad(deps: {
  sessionMgrRef: RefObject<SessionManager>;
  sessionKeyRef: RefObject<string | null>;
  sessionNameRef: RefObject<string | null>;
  sendingRef: RefObject<boolean>;
  streamingRef: RefObject<boolean>;
  activeStreamSessionKeyRef: RefObject<string | null>;
  loadingSessionRef: RefObject<boolean>;
  messagesLenRef: RefObject<number>;
  thinkingSupportGenRef: RefObject<number>;

  navigateToSession: (key: string, replace?: boolean) => void;
  resolveAgentIdForPost: () => string | undefined;
  dismissClarifyOnSessionLoad: () => void;

  sessionKey: string | null;
  loadingMore: boolean;
  hasMore: boolean;
  setLoadingMore: Dispatch<SetStateAction<boolean>>;
  setSessionKey: Dispatch<SetStateAction<string | null>>;
  setSessionName: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setHasMore: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSessionModel: Dispatch<SetStateAction<string>>;
  setThinkingLevel: Dispatch<SetStateAction<string>>;
  setReasoningLevel: Dispatch<SetStateAction<ReasoningLevel>>;
  setModelSupportsThinking: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    sessionMgrRef,
    sessionKeyRef,
    sessionNameRef,
    sendingRef,
    streamingRef,
    activeStreamSessionKeyRef,
    loadingSessionRef,
    messagesLenRef,
    thinkingSupportGenRef,
    navigateToSession,
    resolveAgentIdForPost,
    dismissClarifyOnSessionLoad,
    sessionKey,
    loadingMore,
    hasMore,
    setLoadingMore,
    setSessionKey,
    setSessionName,
    setMessages,
    setHasMore,
    setError,
    setSessionModel,
    setThinkingLevel,
    setReasoningLevel,
    setModelSupportsThinking,
  } = deps;

  const refreshModelThinkingSupport = useCallback(async (modelId: string) => {
    const gen = ++thinkingSupportGenRef.current;
    if (!modelId.trim()) {
      if (gen === thinkingSupportGenRef.current) setModelSupportsThinking(false);
      return;
    }
    const supports = await modelSupportsReasoning(modelId);
    if (gen !== thinkingSupportGenRef.current) return;
    setModelSupportsThinking(supports);
  }, [setModelSupportsThinking, thinkingSupportGenRef]);

  const pollSessionNameAfterTurn = useCallback(async () => {
    const key = sessionKeyRef.current;
    if (!key) return;
    for (let i = 0; i < 8; i++) {
      await new Promise<void>((r) => setTimeout(r, i === 0 ? 500 : 700));
      if (sessionKeyRef.current !== key) return;
      if (sessionNameRef.current?.trim()) return;
      try {
        const name = await sessionMgrRef.current.fetchSessionName(key);
        if (name) {
          setSessionName(name);
          return;
        }
      } catch {
        /* ignore */
      }
    }
  }, [sessionKeyRef, sessionNameRef, sessionMgrRef, setSessionName]);

  const applyLoadedSessionSnapshot = useCallback(
    (chatId: string, data: { messages: Message[]; hasMore: boolean; name?: string }) => {
      if (sessionKeyRef.current !== chatId) {
        return;
      }
      setMessages(data.messages);
      setHasMore(data.hasMore);
      if (data.name) {
        setSessionName(data.name);
      }
    },
    [sessionKeyRef, setMessages, setHasMore, setSessionName],
  );

  const loadSessionById = useCallback(
    async (key: string, offset = 0) => {
      if (
        offset === 0 &&
        key === sessionKeyRef.current &&
        (sendingRef.current || streamingRef.current) &&
        activeStreamSessionKeyRef.current === key
      ) {
        return;
      }
      if (offset === 0) {
        dismissClarifyOnSessionLoad();
      }
      if (loadingSessionRef.current) return;
      loadingSessionRef.current = true;

      try {
        const { messages: loaded, hasMore: more, name } = await sessionMgrRef.current.loadSession(
          key,
          offset,
        );
        if (offset === 0) {
          setSessionKey(key);
          setSessionName(name ?? null);
          setMessages(loaded);
          setHasMore(more);
          setError(null);
          try {
            const cfg = await sessionMgrRef.current.loadSessionAgentConfig(key);
            setSessionModel(cfg.model);
            setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
            setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
            void refreshModelThinkingSupport(cfg.model);
          } catch {
            /* gateway may be older */
          }
        } else {
          setMessages((prev) => {
            const existing = new Set(prev.map((m) => m.timestamp));
            const prepended = loaded.filter((m) => !existing.has(m.timestamp));
            return mergeConsecutiveAssistantMessages([...prepended, ...prev]);
          });
          setHasMore(more);
        }
      } catch {
        if (offset === 0) {
          setError('Failed to load session');
          const sessions = await sessionMgrRef.current.loadSessions().catch(() => [] as SessionInfo[]);
          const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
          const target = withMsgs[0] ?? sessions[0];
          if (target) {
            navigateToSession(target.key);
            await loadSessionById(target.key, 0);
          } else {
            try {
              const aid = resolveAgentIdForPost();
              const session = await sessionMgrRef.current.createSession(
                aid ? { agentId: aid } : undefined,
              );
              navigateToSession(session.key);
              setSessionKey(session.key);
              setMessages([]);
              setHasMore(false);
              try {
                const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
                setSessionModel(cfg.model);
                setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
                setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
                void refreshModelThinkingSupport(cfg.model);
              } catch {
                /* ignore */
              }
            } catch {
              setError('Could not open a session');
            }
          }
        }
      } finally {
        loadingSessionRef.current = false;
      }
    },
    [
      sessionKeyRef,
      sendingRef,
      streamingRef,
      activeStreamSessionKeyRef,
      loadingSessionRef,
      dismissClarifyOnSessionLoad,
      setSessionKey,
      setSessionName,
      setMessages,
      setHasMore,
      setError,
      setSessionModel,
      setThinkingLevel,
      setReasoningLevel,
      navigateToSession,
      refreshModelThinkingSupport,
      resolveAgentIdForPost,
      sessionMgrRef,
    ],
  );

  const loadMoreMessages = useCallback(async () => {
    const key = sessionKeyRef.current;
    if (!key || loadingMore || !hasMore || loadingSessionRef.current) return;
    setLoadingMore(true);
    try {
      await loadSessionById(key, messagesLenRef.current);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadSessionById, loadingMore, messagesLenRef, loadingSessionRef, sessionKeyRef, setLoadingMore]);

  const onSessionModelChange = useCallback(
    async (modelId: string) => {
      if (!sessionKey) return;
      try {
        setError(null);
        await sessionMgrRef.current.patchSessionAgentConfig(sessionKey, { model: modelId });
        setSessionModel(modelId);
        void refreshModelThinkingSupport(modelId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to switch model');
      }
    },
    [sessionKey, sessionMgrRef, setError, setSessionModel, refreshModelThinkingSupport],
  );

  const onSessionThinkingLevelChange = useCallback(
    async (level: string) => {
      if (!sessionKey) return;
      try {
        setError(null);
        await sessionMgrRef.current.patchSessionAgentConfig(sessionKey, { thinkingLevel: level });
        setThinkingLevel(level);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update thinking level');
      }
    },
    [sessionKey, sessionMgrRef, setError, setThinkingLevel],
  );

  const createNewSession = useCallback(async () => {
    dismissClarifyOnSessionLoad();
    try {
      const sessions = await sessionMgrRef.current.loadSessions();
      const aid = resolveAgentIdForPost();
      const empty = pickEmptyWebSessionForAgent(sessions, aid);
      if (empty) {
        setSessionKey(empty.key);
        setSessionName(empty.name ?? null);
        setMessages([]);
        setHasMore(false);
        navigateToSession(empty.key);
        try {
          const cfg = await sessionMgrRef.current.loadSessionAgentConfig(empty.key);
          setSessionModel(cfg.model);
          setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
          setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
          void refreshModelThinkingSupport(cfg.model);
        } catch {
          /* ignore */
        }
        return;
      }
      const session = await sessionMgrRef.current.createSession(
        aid ? { agentId: aid } : undefined,
      );
      setSessionKey(session.key);
      setSessionName(session.name ?? null);
      setMessages([]);
      setHasMore(false);
      navigateToSession(session.key);
      try {
        const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
        setSessionModel(cfg.model);
        setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
        setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
        void refreshModelThinkingSupport(cfg.model);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error('[chat] createNewSession failed:', err);
    }
  }, [
    dismissClarifyOnSessionLoad,
    navigateToSession,
    refreshModelThinkingSupport,
    resolveAgentIdForPost,
    sessionMgrRef,
    setHasMore,
    setMessages,
    setReasoningLevel,
    setSessionKey,
    setSessionModel,
    setSessionName,
    setThinkingLevel,
  ]);

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
