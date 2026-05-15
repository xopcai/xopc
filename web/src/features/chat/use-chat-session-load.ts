import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

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
import { hasPendingAgentRunForChat } from '@/features/chat/message-sender';
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

  navigateToSession: (key: string, replace?: boolean, search?: string) => void;
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

  /** Serialize session loads so rapid route changes (A→B→A) never drop the final `loadSession` fetch. */
  const loadTailRef = useRef(Promise.resolve<void>(undefined));
  /** Bumps when a new title poll starts so rapid `finalizeMessage` calls (e.g. `/goal` multi-turn) do not stack 8×N `limit=1` fetches. */
  const sessionNamePollGenRef = useRef(0);

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
    if (sessionNameRef.current?.trim()) return;

    const gen = ++sessionNamePollGenRef.current;
    const maxAttempts = 5;
    const delaysMs = [700, 900, 900, 1000, 1000];

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise<void>((r) => setTimeout(r, delaysMs[i] ?? 900));
      if (gen !== sessionNamePollGenRef.current) return;
      if (sessionKeyRef.current !== key) return;
      if (sessionNameRef.current?.trim()) return;
      try {
        const name = await sessionMgrRef.current.fetchSessionName(key);
        if (gen !== sessionNamePollGenRef.current) return;
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
    async (key: string, offset = 0): Promise<Message[] | undefined> => {
      const runBody = async (k: string, o: number): Promise<Message[] | undefined> => {
        if (
          o === 0 &&
          k === sessionKeyRef.current &&
          (sendingRef.current || streamingRef.current) &&
          activeStreamSessionKeyRef.current === k
        ) {
          return undefined;
        }
        if (o === 0 && !hasPendingAgentRunForChat(k)) {
          dismissClarifyOnSessionLoad();
        }
        loadingSessionRef.current = true;
        try {
          const { messages: loaded, hasMore: more, name } = await sessionMgrRef.current.loadSession(k, o);
          if (o === 0) {
            setSessionKey(k);
            setSessionName(name ?? null);
            setMessages(loaded);
            setHasMore(more);
            setError(null);
            try {
              const cfg = await sessionMgrRef.current.loadSessionAgentConfig(k);
              setSessionModel(cfg.model);
              setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
              setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
              void refreshModelThinkingSupport(cfg.model);
            } catch {
              /* gateway may be older */
            }
            return loaded;
          }
          setMessages((prev) => {
            const existing = new Set(prev.map((m) => m.timestamp));
            const prepended = loaded.filter((m) => !existing.has(m.timestamp));
            return mergeConsecutiveAssistantMessages([...prepended, ...prev]);
          });
          setHasMore(more);
          return undefined;
        } catch {
          if (o === 0) {
            setError('Failed to load session');
            const sessions = await sessionMgrRef.current.loadSessions().catch(() => [] as SessionInfo[]);
            const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
            const target = withMsgs[0] ?? sessions[0];
            if (target) {
              navigateToSession(target.key, true);
              return await runBody(target.key, 0);
            } else {
              try {
                const aid = resolveAgentIdForPost();
                const session = await sessionMgrRef.current.createSession(
                  aid ? { agentId: aid } : undefined,
                );
                navigateToSession(session.key, true);
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
          return undefined;
        } finally {
          loadingSessionRef.current = false;
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
        return await runBody(key, offset);
      } finally {
        releaseTail();
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
    if (!key || loadingMore || !hasMore) return;
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
