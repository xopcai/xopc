import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  DEFAULT_THINKING,
} from '@/features/chat/session/chat-session-defaults';
import {
  detachChatViewOnly,
  selectDisplayMessages,
  shouldApplyStreamUpdateToView,
  shouldRestoreLiveCacheToView,
} from '@/features/chat/session/chat-session-view';
import { chatRunManager, chatRunSessionKeyRef } from '@/features/chat/session/chat-run-manager';
import {
  getChatSessionSnapshot,
  getSessionMessages,
  isSessionSliceLive,
  useChatSessionStore,
} from '@/features/chat/session/chat-session-store';
import { hasPendingAgentRunForChat, setPendingAgentRun } from '@/features/chat/messages/message-sender';
import { updateToolDetails } from '@/features/chat/messages/streaming';
import { userMessageFromSsePayload } from '@/features/chat/messages/user-message-from-sse';
import { WORKFLOW_TOOL_NAME } from '@/features/chat/workflow/workflow.utils';
import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';
import { SessionManager, type SessionTimelineItem } from '@/features/chat/session/session-manager';
import { patchSessionAgentConfigView } from '@/features/chat/session/patch-session-agent-config-view';
import { resetChatViewState } from '@/features/chat/session/reset-chat-view-state';
import { resolveChatConversationPhase } from '@/features/chat/session/chat-conversation-phase';
import { useChatFollowUpClarify } from '@/features/chat/session/use-chat-follow-up-clarify';
import { useChatSessionAgents } from '@/features/chat/session/use-chat-session-agents';
import { useChatSessionInit } from '@/features/chat/session/use-chat-session-init';
import { useChatSessionLoad } from '@/features/chat/session/use-chat-session-load';
import { focusedSessionKeyRef, useChatSessionRoute } from '@/features/chat/session/use-chat-session-route';
import { useChatSessionStreaming } from '@/features/chat/session/use-chat-session-streaming';
import { useChatSessionWindowEvents } from '@/features/chat/session/use-chat-session-window-events';

/** @see docs/web/chat-session-semantics.md */
export function useChatSession() {
  const navigate = useNavigate();
  const {
    isNewRoute,
    forceNewChat,
    decodedKey,
    viewSessionKey,
    routedFocusedSessionKey,
    routeSessionKeyRef,
    locationKey,
    locationSearch,
    locationState,
  } = useChatSessionRoute();

  const sessionMgrRef = useRef(new SessionManager());
  const loadingSessionRef = useRef(false);
  const sendingRef = useRef(false);
  const streamingRef = useRef(false);
  const thinkingSupportGenRef = useRef(0);
  const streamBusyRef = useRef(false);
  const [timelineItems, setTimelineItems] = useState<SessionTimelineItem[]>([]);

  const sendMessageRef = useRef<
    (
      content: string,
      attachments?: PendingFollowUp['attachments'],
      levelOverride?: string,
    ) => Promise<void>
  >(async () => {});

  const messagesLenRef = useRef(0);

  const focusedSessionKey = routedFocusedSessionKey;
  const initLoading = useChatSessionStore((s) => s.initLoading);
  const loadingMore = useChatSessionStore((s) => s.loadingMore);
  const shellError = useChatSessionStore((s) => s.shellError);
  /** URL is visible-session truth; do not read the store via lagging `focusedSessionKey`. */
  const visibleSessionKey = viewSessionKey;
  const sessionSlice = useChatSessionStore((s) =>
    visibleSessionKey ? s.sessions[visibleSessionKey] : undefined,
  );

  const streamLive = visibleSessionKey ? isSessionSliceLive(sessionSlice) : false;
  const streaming = streamLive ? (sessionSlice?.streaming ?? false) : false;
  const sending = streamLive ? (sessionSlice?.sending ?? false) : false;
  const progress = streamLive ? (sessionSlice?.progress ?? null) : null;
  const hasMore = sessionSlice?.hasMore ?? false;
  const sessionName = sessionSlice?.name ?? null;
  const sessionModel = sessionSlice?.model ?? '';
  const thinkingLevel = sessionSlice?.thinkingLevel ?? DEFAULT_THINKING;
  const reasoningLevel = sessionSlice?.reasoningLevel ?? 'stream';
  const modelSupportsThinking = sessionSlice?.modelSupportsThinking ?? false;
  const effectiveWorkspacePath = sessionSlice?.effectiveWorkspacePath ?? '';
  const workingDirectoryLocked = sessionSlice?.workingDirectoryLocked ?? false;

  useEffect(() => {
    messagesLenRef.current = sessionSlice?.messages.length ?? 0;
  }, [sessionSlice?.messages.length]);

  useEffect(() => {
    sendingRef.current = sending;
    streamingRef.current = streaming;
  }, [sending, streaming]);

  const {
    token,
    chatAgentsData,
    resolveAgentIdForPost,
    onChatAgentChange,
    displayAgentId,
    showChatAgentSelector,
  } = useChatSessionAgents({
    navigate,
    sessionKeyRef: focusedSessionKeyRef,
    sessionKey: focusedSessionKey,
    isNewRoute,
    locationState,
  });

  const sessionRoutePending = Boolean(decodedKey !== undefined && focusedSessionKey !== decodedKey);
  const sessionContentLoading = Boolean(
    decodedKey && sessionSlice?.historyStatus === 'loading' && !sessionRoutePending,
  );
  const showSessionLoading = useMemo(
    () => initLoading && (focusedSessionKey == null || decodedKey === undefined),
    [initLoading, focusedSessionKey, decodedKey],
  );
  const conversationPhase = resolveChatConversationPhase({
    isNewRoute,
    sessionRoutePending,
    showSessionLoading,
    sessionContentLoading,
    messageCount: sessionSlice?.messages.length ?? 0,
  });

  const navigateToSession = useCallback(
    (key: string, replace = false, search?: string) => {
      const s = search ?? '';
      navigate({ pathname: `/chat/${encodeURIComponent(key)}`, search: s }, { replace });
    },
    [navigate],
  );

  const shouldApplyStreamUpdate = useCallback((streamSessionKey: string) => {
    return shouldApplyStreamUpdateToView({
      streamSessionKey,
      routeSessionKey: routeSessionKeyRef.current,
    });
  }, [routeSessionKeyRef]);

  const resetVisibleChatShell = useCallback(() => {
    resetChatViewState({ sendingRef, streamingRef });
  }, []);

  const fq = useChatFollowUpClarify({
    sessionKey: focusedSessionKey,
    decodedKey,
    sessionKeyRef: focusedSessionKeyRef,
    activeStreamSessionKeyRef: chatRunSessionKeyRef,
    sendingRef,
    streamingRef,
    modelSupportsThinking,
    thinkingLevel,
    shouldApplyStreamUpdate,
    sendMessageRef,
  });

  const detachForNewConversation = useCallback(() => {
    fq.clearVisibleClarify();
    chatRunManager.activeResumeRunId = null;
    chatRunManager.userAborted = false;
    detachChatViewOnly(resetVisibleChatShell);
  }, [fq.clearVisibleClarify, resetVisibleChatShell]);

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
    routeSessionKeyRef,
    sendingRef,
    streamingRef,
    activeStreamSessionKeyRef: chatRunSessionKeyRef,
    loadingSessionRef,
    messagesLenRef,
    thinkingSupportGenRef,
    navigateToSession,
    resolveAgentIdForPost,
    dismissClarifyOnSessionLoad: fq.clearVisibleClarify,
    detachForNewConversation,
    sessionKey: focusedSessionKey,
    hasMore,
  });

  const restoreLiveCacheIfNeeded = useCallback((key: string) => {
    if (
      !shouldRestoreLiveCacheToView({
        cacheSessionKey: key,
        routeSessionKey: routeSessionKeyRef.current,
      })
    ) {
      return false;
    }
    const snap = getChatSessionSnapshot(key);
    if (!snap) return false;
    const cacheLive = isSessionSliceLive(snap);
    if (!cacheLive && !hasPendingAgentRunForChat(key) && !chatRunManager.isStreamingFor(key)) {
      return false;
    }
    chatRunManager.activeStreamSessionKey = key;
    sendingRef.current = snap.sending;
    streamingRef.current = snap.streaming;
    return true;
  }, [routeSessionKeyRef]);

  const { tryResumeAgentRun, sendMessage, interruptAndSend, abort, deleteMessageRound, retryUserMessageRound } =
    useChatSessionStreaming({
      sessionKey: focusedSessionKey,
      thinkingLevel,
      modelSupportsThinking,
      sessionKeyRef: focusedSessionKeyRef,
      sendingRef,
      streamingRef,
      sessionMgrRef,
      sendMessageRef,
      shouldApplyStreamUpdate,
      fq,
      applyLoadedSessionSnapshot,
      loadSessionById,
      createNewSession,
      pollSessionNameAfterTurn,
    });

  useEffect(() => {
    if (isNewRoute) {
      detachForNewConversation();
    }
  }, [isNewRoute, detachForNewConversation]);

  const displayMessages = useMemo(
    () =>
      selectDisplayMessages({
        viewSessionKey,
        sessionKey: visibleSessionKey,
        messages: sessionSlice?.messages ?? [],
        streamingMsg: streamLive ? (sessionSlice?.streamingMsg ?? null) : null,
      }),
    [viewSessionKey, visibleSessionKey, sessionSlice?.messages, sessionSlice?.streamingMsg, streamLive],
  );

  const adoptEmptySession = useCallback((key: string, name: string | null) => {
    useChatSessionStore.getState().setCommittedSnapshot(key, { messages: [], hasMore: false, name });
    resetVisibleChatShell();
  }, [resetVisibleChatShell]);

  const applyAgentConfig = useCallback(
    (
      sessionKey: string,
      cfg: {
        model: string;
        thinkingLevel?: string | null;
        reasoningLevel?: string | null;
        effectiveWorkspacePath?: string | null;
        workingDirectoryLocked?: boolean;
      },
    ) => {
      patchSessionAgentConfigView(sessionKey, cfg);
      void refreshModelThinkingSupport(cfg.model);
    },
    [refreshModelThinkingSupport],
  );

  const patchInitUi = useCallback((patch: { loading?: boolean; error?: string | null }) => {
    const store = useChatSessionStore.getState();
    if (patch.loading !== undefined) store.setInitLoading(patch.loading);
    if (patch.error !== undefined) store.setShellError(patch.error);
  }, []);

  const loadTimelineById = useCallback(
    async (key: string) => {
      try {
        const items = await sessionMgrRef.current.loadTimeline(key);
        if (routeSessionKeyRef.current !== key) return;
        setTimelineItems(items);
      } catch {
        if (routeSessionKeyRef.current === key) {
          setTimelineItems([]);
        }
      }
    },
    [routeSessionKeyRef],
  );

  useEffect(() => {
    if (isNewRoute || !focusedSessionKey) {
      setTimelineItems([]);
      return;
    }
    void loadTimelineById(focusedSessionKey);
  }, [focusedSessionKey, isNewRoute, loadTimelineById]);

  useChatSessionWindowEvents({
    sessionKey: focusedSessionKey,
    sessionKeyRef: focusedSessionKeyRef,
    sendingRef,
    streamingRef,
    sessionMgrRef,
    loadSessionById,
    loadTimelineById,
    applyAgentConfig,
  });

  useChatSessionInit({
    token,
    isNewRoute,
    forceNewChat,
    decodedKey,
    locationKey,
    locationSearch,
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

  useEffect(() => {
    const onAgentStream = (e: Event) => {
      const d = (e as CustomEvent<{ sessionKey?: string; event?: unknown }>).detail;
      if (!d?.sessionKey) return;
      const inner = d.event as Record<string, unknown> | undefined;
      if (!inner || typeof inner.type !== 'string') return;

      const streamSessionKey = d.sessionKey;

      if (inner.type === 'user_message' || inner.type === 'user_transcript') {
        const userMsg = userMessageFromSsePayload(inner);
        if (userMsg && shouldApplyStreamUpdate(streamSessionKey)) {
          useChatSessionStore.getState().appendUserMessageIfMissing(streamSessionKey, userMsg);
        }
        return;
      }

      if (inner.type === 'tool_update') {
        const toolName = typeof inner.toolName === 'string' ? inner.toolName : '';
        if (toolName !== WORKFLOW_TOOL_NAME) return;
        if (!shouldApplyStreamUpdate(streamSessionKey)) return;
        if (chatRunManager.isStreamingFor(streamSessionKey)) return;
        const toolCallId = typeof inner.toolCallId === 'string' ? inner.toolCallId : undefined;
        const details = inner.details;
        useChatSessionStore.getState().mutateSessionStreaming(streamSessionKey, (msg) => {
          updateToolDetails(msg.content, toolName, toolCallId, details);
        });
        return;
      }

      if (inner.type !== 'status' || typeof inner.runId !== 'string' || !inner.runId.trim()) {
        return;
      }
      setPendingAgentRun(streamSessionKey, inner.runId);
      if (!shouldApplyStreamUpdate(streamSessionKey)) return;
      if (chatRunManager.isStreamingFor(streamSessionKey)) return;

      queueMicrotask(() => {
        if (!shouldApplyStreamUpdate(streamSessionKey)) return;
        if (chatRunManager.isStreamingFor(streamSessionKey)) return;
        void tryResumeAgentRun(streamSessionKey, getSessionMessages(streamSessionKey));
      });
    };
    window.addEventListener('agent-stream', onAgentStream);
    return () => window.removeEventListener('agent-stream', onAgentStream);
  }, [tryResumeAgentRun, shouldApplyStreamUpdate]);

  useEffect(() => {
    const busy = streaming || sending;
    const wasBusy = streamBusyRef.current;
    streamBusyRef.current = busy;
    if (!wasBusy || busy) return;

    const key = focusedSessionKeyRef.current;
    if (!key) return;
    queueMicrotask(() => {
      if (!key || !shouldApplyStreamUpdate(key)) return;
      if (chatRunManager.isStreamingFor(key)) return;
      if (!hasPendingAgentRunForChat(key)) return;
      void tryResumeAgentRun(key, getSessionMessages(key));
    });
  }, [streaming, sending, tryResumeAgentRun, shouldApplyStreamUpdate]);

  sendMessageRef.current = sendMessage;

  return {
    auth: {
      hasToken: Boolean(token),
    },
    session: {
      sessionKey: focusedSessionKey,
      sessionName,
      decodedKey,
      sessionRoutePending,
      sessionContentLoading,
      showSessionLoading,
      conversationPhase,
      loading: initLoading,
      sessionModel,
      thinkingLevel,
      onSessionThinkingLevelChange,
      reasoningLevel,
      modelSupportsThinking,
      effectiveWorkspacePath,
      workingDirectoryLocked,
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
    timeline: {
      items: timelineItems,
      refresh: loadTimelineById,
    },
    stream: {
      error: shellError,
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
