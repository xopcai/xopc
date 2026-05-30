import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { getLiveSessionCache } from '@/features/chat/session/active-session-live-cache';
import {
  DEFAULT_REASONING,
  DEFAULT_THINKING,
} from '@/features/chat/session/chat-session-defaults';
import {
  type Message,
  type ProgressState,
  type ReasoningLevel,
  coerceReasoningLevel,
} from '@/features/chat/messages/messages.types';
import { hasPendingAgentRunForChat, MessageSender, setPendingAgentRun } from '@/features/chat/messages/message-sender';
import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';
import { SessionManager } from '@/features/chat/session/session-manager';
import { useChatFollowUpClarify } from '@/features/chat/session/use-chat-follow-up-clarify';
import { useChatSessionAgents } from '@/features/chat/session/use-chat-session-agents';
import { useChatSessionInit } from '@/features/chat/session/use-chat-session-init';
import { useChatSessionLoad } from '@/features/chat/session/use-chat-session-load';
import { useChatSessionStreaming } from '@/features/chat/session/use-chat-session-streaming';
import { useChatSessionWindowEvents } from '@/features/chat/session/use-chat-session-window-events';
import { useChatAgentRunIndicatorStore } from '@/stores/chat-agent-run-indicator-store';

export function useChatSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();

  const sessionMgrRef = useRef(new SessionManager());
  const senderRef = useRef(new MessageSender());
  const loadingSessionRef = useRef(false);
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
  const streamingMsgRef = useRef<Message | null>(null);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    streamingMsgRef.current = streamingMsg;
  }, [streamingMsg]);

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
    (key: string, replace = false, search?: string) => {
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
      streamingMsgRef,
    });

  const trackedDecodedKeyRef = useRef(decodedKey);
  if (decodedKey && trackedDecodedKeyRef.current !== decodedKey) {
    trackedDecodedKeyRef.current = decodedKey;
    const active = activeStreamSessionKeyRef.current;
    if (!active || decodedKey !== active) {
      activeStreamSessionKeyRef.current = null;
      sendingRef.current = false;
      streamingRef.current = false;
      setStreamingMsg(null);
      setProgress(null);
      setStreaming(false);
      setSending(false);
    }
  } else if (!decodedKey) {
    trackedDecodedKeyRef.current = undefined;
  }

  const displayMessages = useMemo(() => {
    if (!streamingMsg) return messages;
    return [...messages, streamingMsg];
  }, [messages, streamingMsg]);

  const adoptEmptySession = useCallback((key: string, name: string | null) => {
    setSessionKey(key);
    setSessionName(name);
    setMessages([]);
    setHasMore(false);
  }, []);

  const applyAgentConfig = useCallback(
    (cfg: { model: string; thinkingLevel?: string | null; reasoningLevel?: string | null }) => {
      setSessionModel(cfg.model);
      setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
      setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel ?? undefined));
      void refreshModelThinkingSupport(cfg.model);
    },
    [refreshModelThinkingSupport],
  );

  const patchInitUi = useCallback((patch: { loading?: boolean; error?: string | null }) => {
    if (patch.loading !== undefined) setLoading(patch.loading);
    if (patch.error !== undefined) setError(patch.error);
  }, []);

  useChatSessionWindowEvents({
    sessionKey,
    sessionKeyRef,
    sendingRef,
    streamingRef,
    sessionMgrRef,
    loadSessionById,
    applyAgentConfig,
    setSessionName,
  });

  useChatSessionInit({
    token,
    isNewRoute,
    decodedKey,
    locationSearch: location.search,
    sessionMgrRef,
    resolveAgentIdForPost,
    navigateToSession,
    loadSessionById,
    tryResumeAgentRun,
    restoreLiveCacheIfNeeded,
    adoptEmptySession,
    applyAgentConfig,
    patchInitUi,
  });

  const streamBusy = streaming || sending;
  const trackedAgentIndicatorRef = useRef({ sessionKey, streamBusy });
  if (
    trackedAgentIndicatorRef.current.sessionKey !== sessionKey ||
    trackedAgentIndicatorRef.current.streamBusy !== streamBusy
  ) {
    trackedAgentIndicatorRef.current = { sessionKey, streamBusy };
    const set = useChatAgentRunIndicatorStore.getState().setFocusedAgentRun;
    set(sessionKey ?? null, sessionKey ? streamBusy : false);
  }

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
    },
    clarify: {
      clarifyPrompt: fq.clarifyPrompt,
      clarifySubmitting: fq.clarifySubmitting,
      clarifySubmitError: fq.clarifySubmitError,
      submitClarifyAnswer: fq.submitClarifyAnswer,
      cancelClarifyAnswer: fq.cancelClarifyAnswer,
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
