import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { getLiveSessionCache } from '@/features/chat/active-session-live-cache';
import {
  DEFAULT_REASONING,
  DEFAULT_THINKING,
  pickEmptyWebSessionForAgent,
} from '@/features/chat/chat-session-defaults';
import {
  coerceReasoningLevel,
  type Message,
  type ProgressState,
  type ReasoningLevel,
} from '@/features/chat/messages.types';
import { hasPendingAgentRunForChat, MessageSender, setPendingAgentRun } from '@/features/chat/message-sender';
import type { PendingFollowUp } from '@/features/chat/pending-follow-up.types';
import { SessionManager } from '@/features/chat/session-manager';
import { useChatFollowUpClarify } from '@/features/chat/use-chat-follow-up-clarify';
import { useChatSessionAgents } from '@/features/chat/use-chat-session-agents';
import { useChatSessionLoad } from '@/features/chat/use-chat-session-load';
import { useChatSessionStreaming } from '@/features/chat/use-chat-session-streaming';
import { useChatAgentRunIndicatorStore } from '@/stores/chat-agent-run-indicator-store';

/** Keep only composer deep-link params when replacing `/chat/new?…` with `/chat/:key?…`. */
function searchParamsForComposerHandoff(search: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return '';
  const sp = new URLSearchParams(raw);
  const next = new URLSearchParams();
  const skill = sp.get('skill');
  const slash = sp.get('slash');
  if (skill) next.set('skill', skill);
  if (slash) next.set('slash', slash);
  const out = next.toString();
  return out ? `?${out}` : '';
}

export function useChatSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();

  const sessionMgrRef = useRef(new SessionManager());
  const senderRef = useRef(new MessageSender());
  const loadingSessionRef = useRef(false);
  const initGenRef = useRef(0);
  const sendingRef = useRef(false);
  const streamingRef = useRef(false);
  const sessionKeyRef = useRef<string | null>(null);
  const routeSessionKeyRef = useRef<string | null>(null);
  const activeStreamSessionKeyRef = useRef<string | null>(null);
  const activeResumeRunIdRef = useRef<string | null>(null);
  const sessionNameRef = useRef<string | null>(null);
  const thinkingSupportGenRef = useRef(0);
  const userAbortedRef = useRef(false);
  /** Previous `streaming || sending` to detect idle edge for resuming background webchat runs. */
  const streamBusyRef = useRef(false);

  const sendMessageRef = useRef<
    (
      content: string,
      attachments?: PendingFollowUp['attachments'],
      levelOverride?: string,
    ) => Promise<void>
  >(async () => {});

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMsg, setStreamingMsg] = useState<Message | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionModel, setSessionModel] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState(DEFAULT_THINKING);
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(DEFAULT_REASONING);
  const [modelSupportsThinking, setModelSupportsThinking] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const messagesLenRef = useRef(0);
  const latestMessagesRef = useRef<Message[]>([]);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);
  useEffect(() => {
    sessionNameRef.current = sessionName;
  }, [sessionName]);
  useEffect(() => {
    messagesLenRef.current = messages.length;
  }, [messages.length]);

  const isNewRoute = location.pathname.endsWith('/new');
  const decodedKey = sessionKeyParam ? decodeURIComponent(sessionKeyParam) : undefined;

  routeSessionKeyRef.current = decodedKey ?? null;

  const {
    token,
    chatAgentsData,
    resolveAgentIdForPost,
    onChatAgentChange,
    displayAgentId,
    showChatAgentSelector,
  } = useChatSessionAgents({
    navigate,
    sessionKeyRef,
    sessionKey,
    isNewRoute,
    locationState: location.state,
  });

  /** URL session param does not match loaded state yet (switching sessions or first paint). */
  const sessionRoutePending = Boolean(decodedKey !== undefined && sessionKey !== decodedKey);
  const showSessionLoading = useMemo(
    () => loading && (sessionKey == null || decodedKey === undefined),
    [loading, sessionKey, decodedKey],
  );

  const navigateToSession = useCallback(
    (key: string, replace = true, search?: string) => {
      const s = search ?? '';
      navigate({ pathname: `/chat/${encodeURIComponent(key)}`, search: s }, { replace });
    },
    [navigate],
  );

  const shouldApplyStreamUpdate = useCallback((streamSessionKey: string) => {
    const a = String(streamSessionKey ?? '').trim();
    if (!a) return false;
    const routeKey = String(routeSessionKeyRef.current ?? '').trim();
    const sk = String(sessionKeyRef.current ?? '').trim();
    // Accept if the stream matches either the URL session or the resolved state session.
    // During navigation / hydration, `decodedKey` and `sessionKey` can briefly disagree; matching only
    // the route would drop every SSE token (slash commands look like "no response", no assistant turn).
    if (routeKey && a === routeKey) return true;
    if (sk && a === sk) return true;
    return false;
  }, []);

  const fq = useChatFollowUpClarify({
    sessionKey,
    decodedKey,
    sessionKeyRef,
    activeStreamSessionKeyRef,
    sendingRef,
    streamingRef,
    setSending,
    setStreaming,
    setProgress,
    modelSupportsThinking,
    thinkingLevel,
    shouldApplyStreamUpdate,
    setError,
    sendMessageRef,
  });

  const {
    refreshModelThinkingSupport,
    pollSessionNameAfterTurn,
    applyLoadedSessionSnapshot,
    loadSessionById,
    loadMoreMessages,
    onSessionModelChange,
    onSessionThinkingLevelChange,
    createNewSession,
  } = useChatSessionLoad({
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
    dismissClarifyOnSessionLoad: fq.dismissClarify,
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
  });

  const restoreLiveCacheIfNeeded = useCallback((key: string) => {
    const snap = getLiveSessionCache(key);
    if (!snap) return false;
    if (!hasPendingAgentRunForChat(key) && !senderRef.current.isStreamingFor(key)) return false;
    setMessages(snap.messages);
    setStreamingMsg(snap.streamingMsg);
    setProgress(snap.progress);
    setStreaming(snap.streaming);
    setSending(snap.sending);
    sendingRef.current = snap.sending;
    streamingRef.current = snap.streaming;
    activeStreamSessionKeyRef.current = key;
    return true;
  }, []);

  const { tryResumeAgentRun, sendMessage, interruptAndSend, abort, deleteMessageRound, retryUserMessageRound } =
    useChatSessionStreaming({
      sessionKey,
      thinkingLevel,
      modelSupportsThinking,
      sessionKeyRef,
      sendingRef,
      streamingRef,
      activeStreamSessionKeyRef,
      activeResumeRunIdRef,
      userAbortedRef,
      senderRef,
      sessionMgrRef,
      sendMessageRef,
      setMessages,
      setStreamingMsg,
      setStreaming,
      setSending,
      setProgress,
      setError,
      shouldApplyStreamUpdate,
      fq,
      applyLoadedSessionSnapshot,
      loadSessionById,
      createNewSession,
      pollSessionNameAfterTurn,
      latestMessagesRef,
    });

  useEffect(() => {
    if (!decodedKey) return;
    const active = activeStreamSessionKeyRef.current;
    // Hash session changed (or no stream for this chat): clear stream UI and the
    // guard refs used by `loadSessionById` so returning to a chat always refetches
    // from the gateway. Leaving refs set while `MessageSender` still drains another
    // session caused the load to be skipped and stale messages until full reload.
    if (!active || decodedKey !== active) {
      activeStreamSessionKeyRef.current = null;
      sendingRef.current = false;
      streamingRef.current = false;
      setStreamingMsg(null);
      setProgress(null);
      setStreaming(false);
      setSending(false);
    }
  }, [decodedKey]);

  const displayMessages = useMemo(() => {
    if (!streamingMsg) return messages;
    return [...messages, streamingMsg];
  }, [messages, streamingMsg]);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string; name?: string }>).detail;
      if (!d?.key || d.name === undefined) return;
      if (d.key === sessionKey) setSessionName(d.name || null);
    };
    window.addEventListener('session-updated', handler);
    return () => window.removeEventListener('session-updated', handler);
  }, [sessionKey]);

  useEffect(() => {
    const onConfigReload = () => {
      const key = sessionKeyRef.current;
      if (!key) return;
      void sessionMgrRef.current
        .loadSessionAgentConfig(key)
        .then((cfg) => {
          setSessionModel(cfg.model);
          setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
          setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
          void refreshModelThinkingSupport(cfg.model);
        })
        .catch(() => {});
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, [refreshModelThinkingSupport]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const gen = ++initGenRef.current;
    let cancelled = false;

    const run = async () => {
      const needsFullBlockingLoad = isNewRoute || decodedKey === undefined;
      if (needsFullBlockingLoad) {
        setLoading(true);
      }
      setError(null);

      try {
        if (isNewRoute) {
          const sessions = await sessionMgrRef.current.loadSessions();
          if (cancelled || gen !== initGenRef.current) return;
          const aid = resolveAgentIdForPost();
          const empty = pickEmptyWebSessionForAgent(sessions, aid);
          if (empty) {
            setSessionKey(empty.key);
            setSessionName(empty.name ?? null);
            setMessages([]);
            setHasMore(false);
            navigateToSession(empty.key, true, searchParamsForComposerHandoff(location.search));
            try {
              const cfg = await sessionMgrRef.current.loadSessionAgentConfig(empty.key);
              setSessionModel(cfg.model);
              setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
              setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
              void refreshModelThinkingSupport(cfg.model);
            } catch {
              /* ignore */
            }
          } else {
            const session = await sessionMgrRef.current.createSession(
              aid ? { agentId: aid } : undefined,
            );
            if (cancelled || gen !== initGenRef.current) return;
            setSessionKey(session.key);
            setSessionName(session.name ?? null);
            setMessages([]);
            setHasMore(false);
            navigateToSession(session.key, true, searchParamsForComposerHandoff(location.search));
            try {
              const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
              setSessionModel(cfg.model);
              setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
              setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
              void refreshModelThinkingSupport(cfg.model);
            } catch {
              /* ignore */
            }
          }
        } else if (decodedKey) {
          const loaded = await loadSessionById(decodedKey, 0);
          if (!cancelled && gen === initGenRef.current) {
            restoreLiveCacheIfNeeded(decodedKey);
            const seed = getLiveSessionCache(decodedKey)?.messages ?? loaded ?? [];
            await tryResumeAgentRun(decodedKey, seed);
          }
        } else {
          const sessions = await sessionMgrRef.current.loadSessions();
          if (cancelled || gen !== initGenRef.current) return;
          const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
          const target = withMsgs[0] ?? sessions[0];
          if (target) {
            const loaded = await loadSessionById(target.key, 0);
            if (cancelled || gen !== initGenRef.current) return;
            restoreLiveCacheIfNeeded(target.key);
            const seed = getLiveSessionCache(target.key)?.messages ?? loaded ?? [];
            const keyFromUrl = sessionMgrRef.current.parseSessionFromHash();
            if (!keyFromUrl) navigateToSession(target.key);
            await tryResumeAgentRun(target.key, seed);
          } else {
            const aid = resolveAgentIdForPost();
            const session = await sessionMgrRef.current.createSession(
              aid ? { agentId: aid } : undefined,
            );
            if (cancelled || gen !== initGenRef.current) return;
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
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Chat init failed');
      } finally {
        if (!cancelled && gen === initGenRef.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    token,
    isNewRoute,
    decodedKey,
    navigateToSession,
    loadSessionById,
    tryResumeAgentRun,
    refreshModelThinkingSupport,
    resolveAgentIdForPost,
    restoreLiveCacheIfNeeded,
    location.search,
  ]);

  useEffect(() => {
    const set = useChatAgentRunIndicatorStore.getState().setFocusedAgentRun;
    if (!sessionKey) {
      set(null, false);
      return;
    }
    set(sessionKey, streaming || sending);
  }, [sessionKey, streaming, sending]);

  /**
   * `/goal` (and similar) schedule a follow-up webchat run without a browser POST. Those runs still
   * broadcast `agent.stream` on `/api/events`; subscribe in `GatewaySseConnection`, then mirror POST
   * behaviour: persist `runId` and resume SSE so tokens/tools appear in the open chat.
   */
  useEffect(() => {
    const onAgentStream = (e: Event) => {
      const d = (e as CustomEvent<{ sessionKey?: string; event?: unknown }>).detail;
      if (!d?.sessionKey) return;
      const inner = d.event as { type?: string; runId?: string } | undefined;
      if (!inner || inner.type !== 'status' || typeof inner.runId !== 'string' || !inner.runId.trim()) {
        return;
      }
      setPendingAgentRun(d.sessionKey, inner.runId);
      if (sessionKeyRef.current !== d.sessionKey) return;
      if (senderRef.current.isStreamingFor(d.sessionKey)) return;

      queueMicrotask(() => {
        if (sessionKeyRef.current !== d.sessionKey) return;
        if (senderRef.current.isStreamingFor(d.sessionKey)) return;
        void tryResumeAgentRun(d.sessionKey, latestMessagesRef.current ?? []);
      });
    };
    window.addEventListener('agent-stream', onAgentStream);
    return () => window.removeEventListener('agent-stream', onAgentStream);
  }, [tryResumeAgentRun]);

  useEffect(() => {
    const busy = streaming || sending;
    const wasBusy = streamBusyRef.current;
    streamBusyRef.current = busy;
    if (!wasBusy || busy) return;

    const key = sessionKeyRef.current;
    if (!key) return;
    queueMicrotask(() => {
      if (sessionKeyRef.current !== key) return;
      if (senderRef.current.isStreamingFor(key)) return;
      if (!hasPendingAgentRunForChat(key)) return;
      void tryResumeAgentRun(key, latestMessagesRef.current ?? []);
    });
  }, [streaming, sending, tryResumeAgentRun]);

  sendMessageRef.current = sendMessage;

  return {
    auth: {
      hasToken: Boolean(token),
    },
    session: {
      sessionKey,
      sessionName,
      decodedKey,
      sessionRoutePending,
      showSessionLoading,
      loading,
      sessionModel,
      thinkingLevel,
      onSessionThinkingLevelChange,
      reasoningLevel,
      modelSupportsThinking,
      hasMore,
      loadingMore,
      loadMoreMessages,
      onSessionModelChange,
      createNewSession,
      sessionManager: sessionMgrRef.current,
    },
    messages: {
      items: displayMessages,
    },
    stream: {
      error,
      streaming,
      sending,
      progress,
      sendMessage,
      abort,
      interruptAndSend,
      deleteMessageRound,
      retryUserMessageRound,
    },
    followUp: {
      addPendingFollowUp: fq.addPendingFollowUp,
      pendingFollowUps: fq.pendingFollowUps,
      editingFollowUpId: fq.editingFollowUpId,
      beginEditFollowUp: fq.beginEditFollowUp,
      cancelEditFollowUp: fq.cancelEditFollowUp,
      commitEditFollowUp: fq.commitEditFollowUp,
      removePendingFollowUp: fq.removePendingFollowUp,
      movePendingFollowUp: fq.movePendingFollowUp,
      reorderPendingFollowUp: fq.reorderPendingFollowUp,
      steerPendingFollowUp: fq.steerPendingFollowUp,
      steeringFollowUpId: fq.steeringFollowUpId,
      followUpSuggestions: fq.followUpSuggestions,
      pickFollowUpSuggestion: fq.pickFollowUpSuggestion,
    },
    clarify: {
      clarifyPrompt: fq.clarifyPrompt,
      clarifySubmitting: fq.clarifySubmitting,
      submitClarifyAnswer: fq.submitClarifyAnswer,
    },
    agents: {
      chatAgents: chatAgentsData,
      displayAgentId,
      showChatAgentSelector,
      onChatAgentChange,
    },
  };
}

export type UseChatSessionReturn = ReturnType<typeof useChatSession>;
