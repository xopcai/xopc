import useSWR from 'swr';
import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '../api/registry-api';
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
import { chatRunManager } from '@/features/chat/session/chat-run-manager';
import {
  getChatSessionSnapshot,
  getSessionMessages,
  isSessionSliceLive,
  useChatSessionStore,
} from '@/features/chat/session/chat-session-store';
import { hasPendingAgentRunForChat, setPendingAgentRun } from '@/features/chat/messages/message-sender';
import type { PendingFollowUp } from '@/features/chat/follow-up/pending-follow-up.types';
import type { ComposerContextRef } from '@/features/chat/composer/composer.types';
import { SessionManager, type SessionTimelineItem } from '@/features/chat/session/session-manager';
import { patchSessionAgentConfigView } from '@/features/chat/session/patch-session-agent-config-view';
import { resetChatViewState } from '@/features/chat/session/reset-chat-view-state';
import { resolveChatConversationPhase } from '@/features/chat/session/chat-conversation-phase';
import { useChatFollowUpClarify } from '@/features/chat/session/use-chat-follow-up-clarify';
import { useChatSessionAgents } from '@/features/chat/session/use-chat-session-agents';
import { useChatSessionInit } from '@/features/chat/session/use-chat-session-init';
import { usePreparedSessionModel } from '@/features/chat/session/use-prepared-session-model';
import { useChatSessionLoad } from '@/features/chat/session/use-chat-session-load';
import { focusedConversationIdRef, useChatSessionRoute } from '@/features/chat/session/use-chat-session-route';
import { useChatSessionStreaming } from '@/features/chat/session/use-chat-session-streaming';
import { useChatSessionWindowEvents } from '@/features/chat/session/use-chat-session-window-events';
import type { AppContextEnvelope } from '@xopcai/gateway-contract';

/** @see docs/design/technical/new-session-preferences.md */
export function useChatSession(options?: { fixedConversationId?: string; taskId?: string }) {
  const navigate = useNavigate();
  const {
    isNewRoute,
    forceNewChat,
    decodedKey,
    viewConversationId,
    routedFocusedConversationId,
    routeConversationIdRef,
    locationKey,
    locationSearch,
    locationState,
  } = useChatSessionRoute(options?.fixedConversationId);

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
      contextRefs?: ComposerContextRef[],
      replaceTurnId?: string,
      appContext?: AppContextEnvelope,
      onDispatched?: (clientSubmissionId: string, messageRenderKey?: string) => void,
      replaceClientSubmissionId?: string,
    ) => Promise<void | boolean>
  >(async () => {});

  const messagesLenRef = useRef(0);

  const focusedConversationId = routedFocusedConversationId;
  const initLoading = useChatSessionStore((s) => s.initLoading);
  const loadingMore = useChatSessionStore((s) => s.loadingMore);
  const shellError = useChatSessionStore((s) => s.shellError);
  /** URL is visible-session truth; do not read the store via lagging `focusedConversationId`. */
  const visibleConversationId = viewConversationId;
  const sessionSlice = useChatSessionStore((s) =>
    visibleConversationId ? s.sessions[visibleConversationId] : undefined,
  );

  const streamLive = visibleConversationId ? isSessionSliceLive(sessionSlice) : false;
  const streaming = streamLive ? (sessionSlice?.streaming ?? false) : false;
  const sending = streamLive ? (sessionSlice?.sending ?? false) : false;
  const progress = streamLive ? (sessionSlice?.progress ?? null) : null;
  const taskPlan = streamLive ? (sessionSlice?.taskPlan ?? null) : null;
  const hasMore = sessionSlice?.hasMore ?? false;
  const sessionName = sessionSlice?.name ?? null;
  const sessionModel = sessionSlice?.model ?? '';
  const modelRegistry = useSWR(CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, { revalidateOnFocus: false });
  const modelConfigReady = sessionSlice?.configVersion !== undefined && Boolean(modelRegistry.data?.some((item) => item.id === sessionModel));
  const modelConfigSaving = sessionSlice?.modelConfigSaving ?? false;
  const thinkingLevel = sessionSlice?.thinkingLevel ?? DEFAULT_THINKING;
  const reasoningLevel = sessionSlice?.reasoningLevel ?? 'on';
  const modelSupportsThinking = sessionSlice?.modelSupportsThinking ?? false;
  const effectiveWorkspacePath = sessionSlice?.effectiveWorkspacePath ?? '';
  const workspaceSource = sessionSlice?.workspaceSource ?? 'agent_default_root';
  const userContextMode = sessionSlice?.userContextMode ?? 'enabled';

  useEffect(() => {
    if (!visibleConversationId || sending || streaming) return;
    void sessionMgrRef.current.loadSessionAgentConfig(visibleConversationId)
      .then((cfg) => patchSessionAgentConfigView(visibleConversationId, cfg)).catch(() => undefined);
  }, [visibleConversationId, sending, streaming]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const key = (event as CustomEvent<{ conversationId: string }>).detail.conversationId;
      void sessionMgrRef.current.loadSessionAgentConfig(key).then((cfg) => patchSessionAgentConfigView(key, cfg)).catch(() => undefined);
    };
    window.addEventListener('session-model-config-stale', refresh);
    return () => window.removeEventListener('session-model-config-stale', refresh);
  }, []);

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
    currentSessionProjectId,
  } = useChatSessionAgents({
    navigate,
    conversationIdRef: focusedConversationIdRef,
    conversationId: focusedConversationId,
    isNewRoute,
    locationState,
    locationSearch,
  });

  const sessionRoutePending = Boolean(decodedKey !== undefined && focusedConversationId !== decodedKey);
  const sessionContentLoading = Boolean(
    decodedKey && sessionSlice?.historyStatus === 'loading' && !sessionRoutePending,
  );
  const showSessionLoading = useMemo(
    () => initLoading && (focusedConversationId == null || decodedKey === undefined),
    [initLoading, focusedConversationId, decodedKey],
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

  const shouldApplyStreamUpdate = useCallback((streamConversationId: string) => {
    return shouldApplyStreamUpdateToView({
      streamConversationId,
      routeConversationId: routeConversationIdRef.current,
    });
  }, [routeConversationIdRef]);

  const resetVisibleChatShell = useCallback(() => {
    resetChatViewState({ sendingRef, streamingRef });
  }, []);

  const fq = useChatFollowUpClarify({
    conversationId: focusedConversationId,
    decodedKey,
    conversationIdRef: focusedConversationIdRef,
    sendingRef,
    streamingRef,
    modelSupportsThinking,
    thinkingLevel,
    shouldApplyStreamUpdate,
  });

  const detachForNewConversation = useCallback(() => {
    fq.clearVisibleClarify();
    const key = focusedConversationIdRef.current;
    if (key) chatRunManager.resetRunTracking(key);
    detachChatViewOnly(resetVisibleChatShell);
  }, [fq.clearVisibleClarify, focusedConversationIdRef, resetVisibleChatShell]);

  const {
    refreshModelThinkingSupport,
    pollSessionNameAfterTurn,
    applyLoadedSessionSnapshot,
    loadSessionById,
    loadMoreMessages,
    onSessionModelChange,
    onSessionThinkingLevelChange,
    onSessionWorkingDirectoryChange,
    createNewSession,
    resetCurrentSession,
  } = useChatSessionLoad({
    sessionMgrRef,
    routeConversationIdRef,
    sendingRef,
    streamingRef,
    loadingSessionRef,
    messagesLenRef,
    thinkingSupportGenRef,
    navigateToSession,
    resolveAgentIdForPost,
    detachForNewConversation,
    conversationId: focusedConversationId,
    sessionAgentId: displayAgentId,
    currentProjectId: currentSessionProjectId,
    hasMore,
    taskId: options?.taskId,
  });

  const restoreLiveCacheIfNeeded = useCallback((key: string) => {
    if (
      !shouldRestoreLiveCacheToView({
        cacheConversationId: key,
        routeConversationId: routeConversationIdRef.current,
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
    sendingRef.current = snap.sending;
    streamingRef.current = snap.streaming;
    return true;
  }, [routeConversationIdRef]);

  const {
    tryResumeAgentRun,
    sendMessage,
    replaceLatestUserTurn,
    interruptAndSend,
    abort,
    deleteMessageRound,
    retryUserMessageRound,
  } =
    useChatSessionStreaming({
      conversationId: focusedConversationId,
      taskId: options?.taskId,
      thinkingLevel,
      modelSupportsThinking,
      conversationIdRef: focusedConversationIdRef,
      sendingRef,
      streamingRef,
      sessionMgrRef,
      sendMessageRef,
      shouldApplyStreamUpdate,
      fq,
      applyLoadedSessionSnapshot,
      loadSessionById,
      resetCurrentSession,
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
        viewConversationId,
        conversationId: visibleConversationId,
        messages: sessionSlice?.messages ?? [],
        streamingMsg: streamLive ? (sessionSlice?.streamingMsg ?? null) : null,
      }),
    [viewConversationId, visibleConversationId, sessionSlice?.messages, sessionSlice?.streamingMsg, streamLive],
  );

  const adoptEmptySession = useCallback((key: string, name: string | null) => {
    useChatSessionStore.getState().setCommittedSnapshot(key, { messages: [], hasMore: false, name });
    resetVisibleChatShell();
  }, [resetVisibleChatShell]);

  const applyAgentConfig = useCallback(
    (
      conversationId: string,
      cfg: {
        model: string;
        thinkingLevel?: string | null;
        reasoningLevel?: string | null;
        activityDetail?: {
          default: string;
          override: string | null;
          effective: string;
          source: 'session' | 'default';
        };
        effectiveWorkspacePath?: string | null;
        workspaceSource?: 'execution_environment' | 'project' | 'session_override' | 'agent_default_root' | 'agent_workspace';
      },
    ) => {
      patchSessionAgentConfigView(conversationId, cfg);
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
        const items = await sessionMgrRef.current.loadTimeline(key, options?.taskId);
        if (routeConversationIdRef.current !== key) return;
        setTimelineItems(items);
      } catch {
        if (routeConversationIdRef.current === key) {
          setTimelineItems([]);
        }
      }
    },
    [routeConversationIdRef, options?.taskId],
  );

  useEffect(() => {
    if (isNewRoute || !focusedConversationId) {
      setTimelineItems([]);
      return;
    }
    void loadTimelineById(focusedConversationId);
  }, [focusedConversationId, isNewRoute, loadTimelineById]);

  useChatSessionWindowEvents({
    conversationId: focusedConversationId,
    conversationIdRef: focusedConversationIdRef,
    sendingRef,
    streamingRef,
    sessionMgrRef,
    loadSessionById,
    loadTimelineById,
    applyAgentConfig,
  });

  const projectPreparation = useChatSessionInit({
    token,
    isNewRoute,
    forceNewChat,
    temporary: (locationState as { temporary?: boolean } | null)?.temporary === true,
    requestedAgentId: typeof (locationState as { agentId?: unknown } | null)?.agentId === 'string'
      ? (locationState as { agentId: string }).agentId : undefined,
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
  const preparedModel = usePreparedSessionModel(projectPreparation);
  useEffect(() => {
    if (projectPreparation && preparedModel.error) {
      useChatSessionStore.getState().setShellError(preparedModel.error instanceof Error
        ? preparedModel.error.message : 'Failed to load model configuration');
    }
  }, [projectPreparation, preparedModel.error]);

  useEffect(() => {
    const onRunStarted = (e: Event) => {
      const detail = (e as CustomEvent<{ conversationId?: string; runId?: string }>).detail;
      const streamConversationId = detail?.conversationId;
      const runId = detail?.runId;
      if (!streamConversationId || !runId?.trim()) return;
      setPendingAgentRun(streamConversationId, runId);
      chatRunManager.setResumeRunId(streamConversationId, runId);
      if (!shouldApplyStreamUpdate(streamConversationId)) return;
      if (chatRunManager.isTrackingRun(streamConversationId, runId)) return;

      queueMicrotask(() => {
        if (!shouldApplyStreamUpdate(streamConversationId)) return;
        if (chatRunManager.isTrackingRun(streamConversationId, runId)) return;
        void tryResumeAgentRun(streamConversationId, getSessionMessages(streamConversationId));
      });
    };
    window.addEventListener('run-started', onRunStarted);
    return () => window.removeEventListener('run-started', onRunStarted);
  }, [tryResumeAgentRun, shouldApplyStreamUpdate]);

  useEffect(() => {
    const busy = streaming || sending;
    const wasBusy = streamBusyRef.current;
    streamBusyRef.current = busy;
    if (!wasBusy || busy) return;

    const key = focusedConversationIdRef.current;
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
      projectPreparation: preparedModel.preparation,
      conversationId: focusedConversationId,
      sessionName,
      decodedKey,
      sessionRoutePending,
      sessionContentLoading,
      showSessionLoading,
      conversationPhase,
      loading: initLoading,
      sessionModel: projectPreparation ? preparedModel.model : sessionModel,
      modelConfigReady: projectPreparation ? preparedModel.ready : modelConfigReady,
      modelConfigSaving,
      thinkingLevel: projectPreparation ? preparedModel.thinkingLevel : thinkingLevel,
      onSessionThinkingLevelChange: projectPreparation ? preparedModel.onThinkingChange : onSessionThinkingLevelChange,
      onSessionWorkingDirectoryChange,
      reasoningLevel,
      modelSupportsThinking: projectPreparation ? preparedModel.modelSupportsThinking : modelSupportsThinking,
      effectiveWorkspacePath,
      workspaceSource,
      userContextMode: projectPreparation?.temporary ? 'temporary' as const : userContextMode,
      hasMore,
      loadingMore,
      loadMoreMessages,
      onSessionModelChange: projectPreparation ? preparedModel.onModelChange : onSessionModelChange,
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
      taskPlan,
      sendMessage,
      replaceLatestUserTurn,
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
      letAgentDecideClarification: fq.letAgentDecideClarification,
      cancelClarification: fq.cancelClarification,
    },
    agents: {
      chatAgents: chatAgentsData,
      displayAgentId: projectPreparation?.agentId ?? displayAgentId,
      showChatAgentSelector,
      onChatAgentChange,
    },
  };
}

export type UseChatSessionReturn = ReturnType<typeof useChatSession>;
