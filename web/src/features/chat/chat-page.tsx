import * as Dialog from '@radix-ui/react-dialog';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { fetchCommandsCached } from '@/features/chat/palette/command-palette-api';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatComposer } from '@/features/chat/composer/chat-composer';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { ChatProjectScopeBar } from '@/features/chat/scope/chat-project-scope-bar';
import { useChatProjectScope } from '@/features/chat/scope/use-chat-project-scope';
import { ChatWelcomeSpotlightSkeleton } from '@/features/chat/chat-welcome-spotlight';
import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { ChatRealtimeStatus } from '@/features/chat/agent-selection/chat-realtime-status';
import { ConversationPlanDock } from '@/features/chat/messages/conversation-plan-dock';
import { TaskSessionBanner } from '@/features/chat/task/task-session-banner';
import {
  conversationPlanFromTaskPlanState,
  extractActiveTurnConversationPlan,
} from '@/features/chat/messages/conversation-plan';
import { MessageList } from '@/features/chat/messages/message-list';
import type { Message } from '@/features/chat/messages/messages.types';
import {
  extractUserMessagePlainText,
  messageAttachmentsToWire,
} from '@/features/chat/messages/user-message-plain-text';
import { ScrollToBottomButton } from '@/features/chat/scroll/scroll-to-bottom-button';
import { useChatScrollViewport } from '@/features/chat/scroll/use-chat-scroll-viewport';
import { useChatSession } from '@/features/chat/session/use-chat-session';
import { useChatSessionMetadata } from '@/features/chat/session/use-chat-session-metadata';
import { buildComposerDraftSeed } from '@/features/chat/session/composer-handoff-params';
import { ChatTimelinePanel } from '@/features/chat/timeline/chat-timeline-panel';
import { ChatTimelineRail } from '@/features/chat/timeline/chat-timeline-rail';
import { ClarifyPrompt } from '@/features/chat/composer/clarify-prompt';
import { MemoryCandidatePrompt, MemoryCaptureReceipt, MemoryConsentPrompt } from '@/features/chat/composer/memory-consent-prompt';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { wireTextForSlashCommandEntry } from '@/features/chat/palette/slash-command-wire-text';
import { WorkflowRunLinkCard } from '@/features/chat/workflow/workflow-run-link-card';
import { WorkflowSessionBanner } from '@/features/chat/workflow/workflow-session-banner';
import { useWelcomeSuggestionContext } from '@/features/chat/welcome/use-welcome-suggestion-context';
import {
  buildWelcomeSpotlight,
  type WelcomeSpotlightModel,
  type WelcomeSuggestionSelection,
} from '@/features/chat/welcome/welcome-suggestions';
import {
  readWelcomeSuggestionAffinity,
  recordWelcomeSuggestionMetric,
} from '@/features/chat/welcome/welcome-suggestion-metrics';
import { ProductAutomationFeedback } from '@/features/automations/product-automation-feedback';
import { ACTIVE_RUN_STATUSES } from '@/features/workflows/workflow-page.constants';
import { useSessionWorkflowRunLinks } from '@/features/workflows/use-session-workflow-run-links';
import { useWorkflowRunLive } from '@/features/workflows/use-workflow-run-live';
import { appendNoteContent, createTaskNote, getNote, quickCapture } from '@/features/notes/notes-api';
import { withDetailReturnTo } from '@/lib/navigation-return';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { useChatRunPresenceStore } from '@/features/chat/session/chat-run-presence-store';
import { AgentRunErrorBanner } from '@/features/chat/messages/agent-run-error-banner';
import { parseAgentRunError } from '@/features/chat/messages/agent-run-error-parser';
import { agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { showActivity } from '@/stores/activity-store';
import { Button } from '@/components/ui/button';
import { useTaskDetail } from '@/features/tasks/use-task-detail';
import { peekComposerAttachmentHandoff } from '@/features/chat/composer/composer-attachment-handoff';

const ChatTerminalDock = lazy(async () => {
  const module = await import('@/features/chat/terminal/chat-terminal-dock');
  return { default: module.ChatTerminalDock };
});

type PendingSourceNoteSave = {
  sourceNoteId: string;
  resolve: () => void;
  reject: () => void;
};

type SourceNoteSaveDraft = {
  heading: string;
  content: string;
};

type EditingUserTurn = {
  turnId: string;
};

function welcomePromptWasUsed(original: string, sent: string): boolean {
  const source = original.replace(/\s+/g, '').toLocaleLowerCase();
  const target = sent.replace(/\s+/g, '').toLocaleLowerCase();
  if (!source || !target) return false;
  if (source === target) return true;
  const sampleLength = Math.min(18, Math.max(8, Math.floor(source.length * 0.16)));
  return target.includes(source.slice(0, sampleLength));
}

function welcomeExplorationDaySeed(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function ChatPage({ embedded = false, sessionKey, taskId: boundTaskId }: {
  embedded?: boolean;
  sessionKey?: string;
  taskId?: string;
} = {}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const token = useGatewayStore((s) => s.token);
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const [searchParams] = useSearchParams();
  /** Dedupe applying the same `?skill=` / `?slash=` seed for a session (StrictMode-safe). */
  const routeComposerSeedMarkerRef = useRef<string | null>(null);

  const welcomeDraftSeq = useRef(0);
  const pendingWelcomeSelectionRef = useRef<WelcomeSuggestionSelection | null>(null);
  const welcomeImpressionRef = useRef('');
  const activeWelcomeSpotlightRef = useRef<WelcomeSpotlightModel | null>(null);
  const pendingSourceNoteSaveRef = useRef<PendingSourceNoteSave | null>(null);
  const [welcomeDraftSeed, setWelcomeDraftSeed] = useState<{ id: number; text: string } | null>(null);
  const [welcomeAffinity, setWelcomeAffinity] = useState<Record<string, number>>({});
  const [welcomeExplorationOffset, setWelcomeExplorationOffset] = useState(0);
  const [sourceNoteLoadedTitle, setSourceNoteLoadedTitle] = useState<string | null>(null);
  const [sourceNoteSaveDraft, setSourceNoteSaveDraft] = useState<SourceNoteSaveDraft | null>(null);
  const [sourceNoteSaveSubmitting, setSourceNoteSaveSubmitting] = useState(false);
  const [sourceNoteSaveError, setSourceNoteSaveError] = useState<string | null>(null);
  const [showWelcomeSkeleton, setShowWelcomeSkeleton] = useState(false);
  const [editingUserTurn, setEditingUserTurn] = useState<EditingUserTurn | null>(null);

  const taskId = boundTaskId?.trim() || null;
  const { data: taskDetail } = useTaskDetail(taskId ?? '');
  const { auth, session, messages: msgSlice, timeline, stream, followUp, clarify, agents } = useChatSession({
    fixedSessionKey: sessionKey,
    taskId: taskId ?? undefined,
  });

  const skillQuery = searchParams.get('skill')?.trim() ?? '';
  const slashQuery = searchParams.get('slash')?.trim() ?? '';
  const draftQuery = searchParams.get('draft') ?? '';
  const autoSendQuery = searchParams.get('autoSend') === '1';
  const attachmentHandoffId = searchParams.get('attachmentHandoff');
  const chatSessionKey = session.decodedKey ?? session.sessionKey;
  const [launchFile, setLaunchFile] = useState<Pick<File, 'name' | 'type'> | null>(null);
  const launchFileSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (attachmentHandoffId) {
      const file = peekComposerAttachmentHandoff(attachmentHandoffId);
      if (file) setLaunchFile(file);
      launchFileSessionRef.current = chatSessionKey;
      return;
    }
    if (launchFileSessionRef.current !== chatSessionKey) {
      launchFileSessionRef.current = chatSessionKey;
      setLaunchFile(null);
    }
  }, [attachmentHandoffId, chatSessionKey]);
  const markChatRunViewed = useChatRunPresenceStore((state) => state.markViewed);
  useEffect(() => {
    if (chatSessionKey) markChatRunViewed(chatSessionKey);
  }, [chatSessionKey, markChatRunViewed]);
  const { data: sessionMetadata } = useChatSessionMetadata(chatSessionKey);
  const workflowRunId = sessionMetadata?.workflowRunId ?? null;
  const workflowOwnerAgentId = sessionMetadata?.ownerAgentId ?? undefined;
  const { view: workflowRunView } = useWorkflowRunLive(workflowRunId, { ownerAgentId: workflowOwnerAgentId });
  const { data: workflowRunLinks = [], mutate: refreshWorkflowRunLinks } =
    useSessionWorkflowRunLinks(chatSessionKey);
  const showWorkflowLiveBanner = Boolean(
    workflowRunId &&
      workflowRunView &&
      ACTIVE_RUN_STATUSES.has(workflowRunView.run.status),
  );

  useEffect(() => {
    if (!chatSessionKey) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; sessionKey?: string }>).detail;
      const updatedKey = detail?.key ?? detail?.sessionKey;
      if (updatedKey === chatSessionKey) {
        void refreshWorkflowRunLinks();
      }
    };
    window.addEventListener('session-transcript-updated', handler);
    window.addEventListener('workflow-run-started-from-chat', handler);
    return () => {
      window.removeEventListener('session-transcript-updated', handler);
      window.removeEventListener('workflow-run-started-from-chat', handler);
    };
  }, [chatSessionKey, refreshWorkflowRunLinks]);

  useEffect(() => {
    routeComposerSeedMarkerRef.current = null;
  }, [session.sessionKey]);

  useEffect(() => {
    if (!auth.hasToken) return;
    if (!skillQuery && !slashQuery && !draftQuery) return;
    if (autoSendQuery) return;
    if (session.showSessionLoading || session.sessionRoutePending) return;
    if (!session.sessionKey) return;

    const stripRouteComposerParams = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('skill');
      next.delete('slash');
      next.delete('draft');
      const qs = next.toString();
      navigate({ pathname, search: qs ? `?${qs}` : '' }, { replace: true });
    };

    /** After session + clear effect; same idea as `fillChatComposerWithNavigate` (rAF / microtask). */
    const applyWireSeed = (text: string, marker: string) => {
      if (routeComposerSeedMarkerRef.current === marker) return;
      routeComposerSeedMarkerRef.current = marker;
      queueMicrotask(() => {
        welcomeDraftSeq.current += 1;
        setWelcomeDraftSeed({ id: welcomeDraftSeq.current, text });
        stripRouteComposerParams();
      });
    };

    const composerDraftSeed = buildComposerDraftSeed(skillQuery, draftQuery);
    if (composerDraftSeed) {
      const marker = `${session.sessionKey}:draft:${composerDraftSeed}`;
      applyWireSeed(composerDraftSeed, marker);
      return;
    }

    if (skillQuery) {
      stripRouteComposerParams();
      return;
    }

    const slashNameRe = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (!slashNameRe.test(slashQuery)) {
      stripRouteComposerParams();
      return;
    }
    const marker = `${session.sessionKey}:slash:${slashQuery}`;
    if (routeComposerSeedMarkerRef.current === marker) return;
    queueMicrotask(() => {
      void (async () => {
        try {
          const cmds = await fetchCommandsCached();
          const needle = slashQuery.toLowerCase();
          const c = cmds.find(
            (x) =>
              x.name.toLowerCase() === needle ||
              (Array.isArray(x.aliases) && x.aliases.some((a) => a.toLowerCase() === needle)),
          );
          if (c) {
            if (routeComposerSeedMarkerRef.current === marker) return;
            routeComposerSeedMarkerRef.current = marker;
            welcomeDraftSeq.current += 1;
            setWelcomeDraftSeed({ id: welcomeDraftSeq.current, text: wireTextForSlashCommandEntry(c) });
          }
        } finally {
          stripRouteComposerParams();
        }
      })();
    });
  }, [
    auth.hasToken,
    skillQuery,
    slashQuery,
    draftQuery,
    autoSendQuery,
    searchParams,
    session.showSessionLoading,
    session.sessionRoutePending,
    session.sessionKey,
    navigate,
    pathname,
  ]);

  const {
    scrollRef,
    atBottom,
    registerListContentRef,
    scrollToBottom,
    onScroll: onChatViewportScroll,
  } = useChatScrollViewport({
    hasToken: auth.hasToken,
    showSessionLoading: session.showSessionLoading,
    sessionKey: session.sessionKey,
    sending: stream.sending,
    chatMessages: msgSlice.items,
    hasMore: session.hasMore,
    loadingMore: session.loadingMore,
    loadMoreMessages: session.loadMoreMessages,
  });
  const clarifyPromptVisible = Boolean(clarify.clarifyPrompt);
  const prevClarifyPromptVisibleRef = useRef(clarifyPromptVisible);

  useLayoutEffect(() => {
    const prev = prevClarifyPromptVisibleRef.current;
    prevClarifyPromptVisibleRef.current = clarifyPromptVisible;
    if (prev === clarifyPromptVisible) return;
    if (session.showSessionLoading || session.sessionRoutePending) return;

    scrollToBottom(false);
    const raf = requestAnimationFrame(() => scrollToBottom(false));
    return () => cancelAnimationFrame(raf);
  }, [clarifyPromptVisible, scrollToBottom, session.showSessionLoading, session.sessionRoutePending]);

  const [activeMessageIndex, setActiveMessageIndex] = useState(0);
  const timelineRafRef = useRef<number | null>(null);
  const pendingTimelineDisplayIndexRef = useRef<number | null>(null);
  const timelineDisplayOffset = useMemo(() => {
    let maxDisplayIndex = -1;
    for (const item of timeline.items) {
      if (typeof item.displayIndex === 'number' && Number.isFinite(item.displayIndex)) {
        maxDisplayIndex = Math.max(maxDisplayIndex, item.displayIndex);
      }
    }
    if (maxDisplayIndex < 0) return 0;
    return Math.max(0, maxDisplayIndex + 1 - msgSlice.items.length);
  }, [msgSlice.items.length, timeline.items]);

  const scrollToLocalMessageIndex = useCallback(
    (localMessageIndex: number) => {
      const root = scrollRef.current;
      if (!root) return false;
      const target = root.querySelector<HTMLElement>(
        `[data-chat-message-index="${localMessageIndex}"]`,
      );
      if (!target) return false;
      setActiveMessageIndex(localMessageIndex);
      const rootRect = root.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const scrollTop = root.scrollTop + targetRect.top - rootRect.top - 16;
      root.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
      return true;
    },
    [scrollRef],
  );

  const updateActiveMessageIndex = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-chat-message-index]'));
    if (rows.length === 0) {
      setActiveMessageIndex(0);
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const anchorY = rootRect.top + Math.min(180, rootRect.height * 0.35);
    let best = rows[0];
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.top <= anchorY) {
        best = row;
        continue;
      }
      break;
    }
    const raw = best.dataset.chatMessageIndex;
    const next = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(next)) {
      setActiveMessageIndex((prev) => (prev === next ? prev : next));
    }
  }, [scrollRef]);

  const scheduleTimelineActiveUpdate = useCallback(() => {
    if (timelineRafRef.current != null) {
      cancelAnimationFrame(timelineRafRef.current);
    }
    timelineRafRef.current = requestAnimationFrame(() => {
      timelineRafRef.current = null;
      updateActiveMessageIndex();
    });
  }, [updateActiveMessageIndex]);

  const handleChatScroll = useCallback(() => {
    onChatViewportScroll();
    scheduleTimelineActiveUpdate();
  }, [onChatViewportScroll, scheduleTimelineActiveUpdate]);

  const handleTimelineSelect = useCallback(
    (messageIndex: number) => {
      const localMessageIndex = messageIndex - timelineDisplayOffset;
      if (localMessageIndex < 0 || localMessageIndex >= msgSlice.items.length) {
        if (localMessageIndex < 0 && session.hasMore && !session.loadingMore) {
          pendingTimelineDisplayIndexRef.current = messageIndex;
          void session.loadMoreMessages();
        }
        return;
      }
      pendingTimelineDisplayIndexRef.current = null;
      scrollToLocalMessageIndex(localMessageIndex);
    },
    [
      msgSlice.items.length,
      scrollToLocalMessageIndex,
      session.hasMore,
      session.loadMoreMessages,
      session.loadingMore,
      timelineDisplayOffset,
    ],
  );

  useEffect(() => {
    const pending = pendingTimelineDisplayIndexRef.current;
    if (pending == null) return;
    const localMessageIndex = pending - timelineDisplayOffset;
    if (localMessageIndex >= 0 && localMessageIndex < msgSlice.items.length) {
      pendingTimelineDisplayIndexRef.current = null;
      requestAnimationFrame(() => scrollToLocalMessageIndex(localMessageIndex));
      return;
    }
    if (localMessageIndex < 0 && session.hasMore && !session.loadingMore) {
      void session.loadMoreMessages();
      return;
    }
    if (localMessageIndex >= msgSlice.items.length || !session.hasMore) {
      pendingTimelineDisplayIndexRef.current = null;
    }
  }, [
    msgSlice.items.length,
    scrollToLocalMessageIndex,
    session.hasMore,
    session.loadMoreMessages,
    session.loadingMore,
    timelineDisplayOffset,
  ]);

  useEffect(() => {
    scheduleTimelineActiveUpdate();
  }, [msgSlice.items.length, scheduleTimelineActiveUpdate, session.sessionKey, timelineDisplayOffset]);

  useEffect(() => {
    return () => {
      if (timelineRafRef.current != null) {
        cancelAnimationFrame(timelineRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setWelcomeDraftSeed(null);
    pendingWelcomeSelectionRef.current = null;
    welcomeImpressionRef.current = '';
    setWelcomeAffinity({});
  }, [session.sessionKey]);

  const onPickWelcomePrompt = useCallback((selection: WelcomeSuggestionSelection) => {
    pendingWelcomeSelectionRef.current = selection;
    recordWelcomeSuggestionMetric({
      type: 'pick',
      suggestionId: selection.suggestionId,
      categoryId: selection.categoryId,
      contextKind: selection.contextKind,
      agentId: agents.displayAgentId,
    });
    welcomeDraftSeq.current += 1;
    setWelcomeDraftSeed({ id: welcomeDraftSeq.current, text: selection.prompt });
  }, [agents.displayAgentId]);
  const refreshWelcomeExploration = useCallback(() => {
    const spotlight = activeWelcomeSpotlightRef.current;
    const exploration = spotlight?.categories.find((category) => category.scope === 'explore');
    const scenario = exploration?.scenarios[0];
    if (spotlight && exploration && scenario) {
      recordWelcomeSuggestionMetric({
        type: 'skip',
        suggestionId: scenario.id ?? `${exploration.id}:0`,
        categoryId: exploration.id,
        contextKind: spotlight.contextKind,
        agentId: agents.displayAgentId,
      });
    }
    setWelcomeExplorationOffset((value) => value + 1);
  }, [agents.displayAgentId]);
  const selectWelcomeProject = useCallback(
    async (projectId: string) => {
      await session.createNewSession({ projectId });
    },
    [session.createNewSession],
  );
  const canChangeWorkingDirectory = Boolean(
    session.sessionKey &&
    !session.showSessionLoading &&
    !session.sessionRoutePending &&
    session.workspaceSource !== 'project' &&
    msgSlice.items.length === 0,
  );

  const setWorkspaceEditorAgentId = useWorkspaceEditorAgentStore((s) => s.setAgentId);

  useEffect(() => {
    if (!auth.hasToken) return;
    setWorkspaceEditorAgentId(agents.displayAgentId);
    return () => setWorkspaceEditorAgentId('');
  }, [auth.hasToken, agents.displayAgentId, setWorkspaceEditorAgentId]);

  const isCreatingSession = session.conversationPhase === 'creating-session';
  const isLoadingHistory = session.conversationPhase === 'loading-history';
  const isSessionTransitioning = isCreatingSession || isLoadingHistory;
  /** Match `MessageList` empty welcome: tighter vertical padding so the first screen fits without scrolling. */
  const showConversationLoading = isLoadingHistory;
  const compactWelcomeLayout =
    !showConversationLoading && msgSlice.items.length === 0 && !stream.streaming;
  const latestConversationPlan = useMemo(
    () => {
      if (stream.taskPlan) {
        const livePlan = conversationPlanFromTaskPlanState(stream.taskPlan);
        if (!livePlan) return null;
        const fallback = extractActiveTurnConversationPlan(msgSlice.items, stream.streaming);
        return { plan: livePlan, changeSummary: fallback?.changeSummary ?? null };
      }
      return extractActiveTurnConversationPlan(msgSlice.items, stream.streaming);
    },
    [msgSlice.items, stream.streaming, stream.taskPlan],
  );
  const chatHeadline = useMemo(() => {
    const titleKey =
      session.sessionRoutePending && session.decodedKey ? session.decodedKey : session.sessionKey;
    if (!titleKey) return m.nav.chat;
    return session.sessionName?.trim() || m.chat.newSession;
  }, [
    session.sessionKey,
    session.sessionName,
    session.sessionRoutePending,
    session.decodedKey,
    m.nav.chat,
    m.chat.newSession,
  ]);

  const sourceNoteId = sessionMetadata?.sourceNoteId ?? null;
  const scopedProject = useChatProjectScope(chatSessionKey);
  useEffect(() => {
    let cancelled = false;
    setSourceNoteLoadedTitle(null);
    if (!sourceNoteId) return undefined;
    void getNote(sourceNoteId)
      .then((note) => {
        if (cancelled) return;
        setSourceNoteLoadedTitle(note?.title?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setSourceNoteLoadedTitle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceNoteId]);

  const sourceNoteTitle =
    sourceNoteLoadedTitle || sessionMetadata?.sourceNoteTitle || m.chat.sourceNoteFallbackTitle;
  const welcomeContextState = useWelcomeSuggestionContext({
    enabled:
      auth.hasToken &&
      Boolean(chatSessionKey) &&
      msgSlice.items.length === 0 &&
      !session.showSessionLoading &&
      !session.sessionRoutePending,
    sessionKey: chatSessionKey,
    sourceNoteId,
    sourceNoteTitle,
    effectiveWorkspacePath: session.effectiveWorkspacePath,
    workingDirectoryLocked:
      session.workspaceSource === 'session_override' || session.workspaceSource === 'agent_workspace',
    task: taskDetail,
    file: launchFile,
    workflow: workflowRunView,
    sessionManager: session.sessionManager,
  });
  const welcomeAgent = useMemo(
    () =>
      agents.chatAgents?.items.find((item) => item.id === agents.displayAgentId) ?? {
        id: agents.displayAgentId,
      },
    [agents.chatAgents?.items, agents.displayAgentId],
  );
  useEffect(() => {
    setWelcomeAffinity(
      readWelcomeSuggestionAffinity(welcomeContextState.context.kind, agents.displayAgentId),
    );
  }, [agents.displayAgentId, welcomeContextState.context.kind]);
  const welcomeSpotlight = useMemo(
    () =>
      buildWelcomeSpotlight(welcomeContextState.context, m.chat.welcomeSpotlight, welcomeAgent, {
        affinity: welcomeAffinity,
        contextStatus: welcomeContextState.status,
        explorationSeed: welcomeExplorationDaySeed(),
        explorationOffset: welcomeExplorationOffset,
      }),
    [
      m.chat.welcomeSpotlight,
      welcomeAffinity,
      welcomeAgent,
      welcomeContextState.context,
      welcomeContextState.status,
      welcomeExplorationOffset,
    ],
  );
  const welcomeContextLoading = welcomeContextState.status === 'loading';
  const activeWelcomeSpotlight = welcomeContextLoading ? undefined : welcomeSpotlight;
  activeWelcomeSpotlightRef.current = activeWelcomeSpotlight ?? null;
  useEffect(() => {
    if (!welcomeContextLoading) {
      setShowWelcomeSkeleton(false);
      return undefined;
    }
    const timeout = window.setTimeout(() => setShowWelcomeSkeleton(true), 180);
    return () => window.clearTimeout(timeout);
  }, [welcomeContextLoading]);
  const primaryWelcomeSelection = useMemo<WelcomeSuggestionSelection | null>(
    () =>
      activeWelcomeSpotlight
        ? {
            suggestionId: activeWelcomeSpotlight.primaryRecommendation.id,
            categoryId: activeWelcomeSpotlight.primaryRecommendation.categoryId,
            contextKind: activeWelcomeSpotlight.contextKind,
            prompt: activeWelcomeSpotlight.primaryRecommendation.prompt,
          }
        : null,
    [activeWelcomeSpotlight],
  );

  useEffect(() => {
    if (msgSlice.items.length > 0 || stream.streaming) return;
    if (!activeWelcomeSpotlight) return;
    const recommendation = activeWelcomeSpotlight.primaryRecommendation;
    const impressionKey = `${chatSessionKey ?? 'new'}:${activeWelcomeSpotlight.contextStatus}:${recommendation.id}`;
    if (welcomeImpressionRef.current === impressionKey) return;
    welcomeImpressionRef.current = impressionKey;
    recordWelcomeSuggestionMetric({
      type: 'impression',
      suggestionId: recommendation.id,
      categoryId: recommendation.categoryId,
      contextKind: activeWelcomeSpotlight.contextKind,
      agentId: agents.displayAgentId,
    });
  }, [activeWelcomeSpotlight, agents.displayAgentId, chatSessionKey, msgSlice.items.length, stream.streaming]);

  const handleComposerSend = useCallback(
    (...args: Parameters<typeof stream.sendMessage>) => {
      const [text] = args;
      const selection = pendingWelcomeSelectionRef.current;
      if (selection && welcomePromptWasUsed(selection.prompt, text)) {
        recordWelcomeSuggestionMetric({
          type: 'send',
          suggestionId: selection.suggestionId,
          categoryId: selection.categoryId,
          contextKind: selection.contextKind,
          agentId: agents.displayAgentId,
          edited: selection.prompt.trim() !== text.trim(),
          characterDelta: text.length - selection.prompt.length,
        });
      }
      pendingWelcomeSelectionRef.current = null;
      if (editingUserTurn) {
        setEditingUserTurn(null);
        return stream.replaceLatestUserTurn(
          editingUserTurn.turnId,
          args[0],
          args[1],
          args[2],
        );
      }
      return stream.sendMessage(...args);
    },
    [agents.displayAgentId, editingUserTurn, stream.replaceLatestUserTurn, stream.sendMessage],
  );

  const handleEditUserMessage = useCallback((message: Message) => {
    if (!message.turnId) return;
    setEditingUserTurn({ turnId: message.turnId });
    dispatchFillChatComposer(
      extractUserMessagePlainText(message.content),
      messageAttachmentsToWire(message.attachments),
    );
  }, []);

  const handleCancelUserMessageEdit = useCallback(() => {
    setEditingUserTurn(null);
    dispatchFillChatComposer('');
  }, []);

  useEffect(() => {
    setEditingUserTurn(null);
  }, [session.sessionKey]);

  useEffect(() => {
    if (!autoSendQuery || !draftQuery.trim()) return;
    if (!auth.hasToken || session.showSessionLoading || session.sessionRoutePending) return;
    if (!session.sessionKey || stream.sending || stream.streaming || msgSlice.items.length > 0) return;
    const message = buildComposerDraftSeed(skillQuery, draftQuery);
    if (!message) return;
    const marker = `${session.sessionKey}:auto-send:${message}`;
    if (routeComposerSeedMarkerRef.current === marker) return;
    routeComposerSeedMarkerRef.current = marker;
    const next = new URLSearchParams(searchParams);
    next.delete('skill');
    next.delete('slash');
    next.delete('draft');
    next.delete('autoSend');
    const query = next.toString();
    navigate({ pathname, search: query ? `?${query}` : '' }, { replace: true });
    void handleComposerSend(message);
  }, [
    auth.hasToken,
    autoSendQuery,
    draftQuery,
    handleComposerSend,
    msgSlice.items.length,
    navigate,
    pathname,
    searchParams,
    session.sessionKey,
    session.sessionRoutePending,
    session.showSessionLoading,
    skillQuery,
    stream.sending,
    stream.streaming,
  ]);
  const closeSourceNoteSaveDialog = useCallback(() => {
    pendingSourceNoteSaveRef.current?.reject();
    pendingSourceNoteSaveRef.current = null;
    setSourceNoteSaveDraft(null);
    setSourceNoteSaveSubmitting(false);
  }, []);

  useEffect(() => {
    closeSourceNoteSaveDialog();
  }, [closeSourceNoteSaveDialog, sourceNoteId]);

  const timelineLabels = useMemo(
    () => ({
      title: m.chat.timelineTitle,
      turn: m.chat.timelineTurn,
      messageFallback: m.chat.timelineMessageFallback,
      toolCount_one: m.chat.timelineToolCount_one,
      toolCount_other: m.chat.timelineToolCount_other,
      searchedWeb: m.chat.stepSearchedWeb,
      searchedMemory: m.chat.stepSearchedMemory,
      searchedCode: m.chat.stepSearchedCode,
      searched: m.chat.stepSearched,
      readFile: m.chat.stepReadFile,
      runCommand: m.chat.stepRunCommand,
      listDirectory: m.chat.stepListDirectory,
      writeFile: m.chat.stepWriteFile,
      editFile: m.chat.stepEditFile,
      openUrl: m.chat.stepOpenUrl,
      fetchUrl: m.chat.stepFetchUrl,
      unknownTool: m.chat.stepUnknownTool,
    }),
    [
      m.chat.timelineTitle,
      m.chat.timelineTurn,
      m.chat.timelineMessageFallback,
      m.chat.timelineToolCount_one,
      m.chat.timelineToolCount_other,
      m.chat.stepSearchedWeb,
      m.chat.stepSearchedMemory,
      m.chat.stepSearchedCode,
      m.chat.stepSearched,
      m.chat.stepReadFile,
      m.chat.stepRunCommand,
      m.chat.stepListDirectory,
      m.chat.stepWriteFile,
      m.chat.stepEditFile,
      m.chat.stepOpenUrl,
      m.chat.stepFetchUrl,
      m.chat.stepUnknownTool,
    ],
  );

  const handleSaveAssistantToSourceNote = useCallback(
    async (content: string) => {
      if (!sourceNoteId) return;
      pendingSourceNoteSaveRef.current?.reject();
      setSourceNoteSaveSubmitting(false);
      const sourceLine = m.chat.sourceNoteAppendSourceLine.replace(
        '{{time}}',
        new Date().toLocaleString(language),
      );
      setSourceNoteSaveDraft({
        heading: m.chat.sourceNoteAppendHeading,
        content: `${sourceLine}\n\n${content.trim()}`,
      });
      return new Promise<void>((resolve, reject) => {
        pendingSourceNoteSaveRef.current = {
          sourceNoteId,
          resolve,
          reject,
        };
      });
    },
    [language, m.chat.sourceNoteAppendHeading, m.chat.sourceNoteAppendSourceLine, sourceNoteId],
  );

  const handleSaveAssistantAsNote = useCallback(async (content: string) => {
    try {
      const note = await quickCapture(content.trim(), 'web');
      showComposerNotification('success', m.chat.messageSavedToNote, undefined, {
        href: `/notes/${encodeURIComponent(note.id)}`,
      });
    } catch (err) {
      showComposerNotification('error', err instanceof Error ? err.message : m.notes.quickCaptureFailed);
      throw err;
    }
  }, [m.chat.messageSavedToNote, m.notes.quickCaptureFailed]);

  const handleConfirmSourceNoteSave = useCallback(async () => {
    const pending = pendingSourceNoteSaveRef.current;
    if (!pending || !sourceNoteSaveDraft) return;
    const heading = sourceNoteSaveDraft.heading.trim() || m.chat.sourceNoteAppendHeading;
    const content = sourceNoteSaveDraft.content.trim();
    if (!content) return;

    setSourceNoteSaveSubmitting(true);
    setSourceNoteSaveError(null);
    try {
      await appendNoteContent(pending.sourceNoteId, content, heading);
      window.dispatchEvent(
        new CustomEvent('note-updated', {
          detail: {
            noteId: pending.sourceNoteId,
            source: 'chat',
            sessionKey: chatSessionKey,
          },
        }),
      );
      pending.resolve();
      pendingSourceNoteSaveRef.current = null;
      setSourceNoteSaveDraft(null);
    } catch (err) {
      setSourceNoteSaveError(err instanceof Error ? err.message : m.chat.sourceNoteSaveFailed);
    } finally {
      setSourceNoteSaveSubmitting(false);
    }
  }, [
    chatSessionKey,
    m.chat.sourceNoteAppendHeading,
    m.chat.sourceNoteSaveFailed,
    m.chat.sourceNoteSaveSuccess,
    sourceNoteSaveDraft,
  ]);

  const handleExtractAssistantTask = useCallback(
    async (content: string) => {
      if (!sourceNoteId) return;
      const title = content.trim().split(/\n+/)[0]?.replace(/^[-#*>\s]+/, '').trim() || m.chat.sourceNoteTaskFallbackTitle;
      try {
        await createTaskNote(title.slice(0, 120), {
          sourceNoteId,
          sourceSessionKey: chatSessionKey,
        });
      } catch (err) {
        showComposerNotification('error', err instanceof Error ? err.message : m.chat.sourceNoteTaskFailed);
        throw err;
      }
    },
    [
      chatSessionKey,
      m.chat.sourceNoteTaskFailed,
      m.chat.sourceNoteTaskFallbackTitle,
      m.chat.sourceNoteTaskSuccess,
      sourceNoteId,
    ],
  );

  const handleDraftSourceNoteDigest = useCallback(() => {
    if (!sourceNoteId) return;
    const prompt = m.chat.sourceNoteDigestPrompt.replace('{{title}}', sourceNoteTitle);
    if (stream.streaming || stream.sending) {
      void followUp.addPendingFollowUp(prompt);
      showActivity({
        tone: 'info',
        status: 'done',
        title: m.chat.sourceNoteDigestQueued,
        source: language === 'zh' ? '笔记整理' : 'Note digest',
        dedupeKey: sourceNoteId ? `note-digest:${sourceNoteId}` : undefined,
      });
      return;
    }
    void stream.sendMessage(prompt);
  }, [
    followUp,
    language,
    m.chat.sourceNoteDigestPrompt,
    m.chat.sourceNoteDigestQueued,
    sourceNoteId,
    sourceNoteTitle,
    stream,
  ]);

  if (!auth.hasToken) {
    return (
      <div className="mx-auto w-full max-w-[var(--max-width-chat)] px-3 py-16 text-center text-sm leading-relaxed text-fg-muted sm:px-5">
        {m.chat.needToken}
      </div>
    );
  }

  const sessionError = stream.error ? parseAgentRunError(stream.error) : null;
  if (sessionError?.code === 'session_not_found') {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-panel">
        <ChatRealtimeStatus />
        <ChatPageHeaderRegistration
          chatHeadline={m.chat.sessionNotFoundTitle}
          chatAgents={agents.chatAgents?.items ?? []}
          showChatAgentSelector={false}
          chatAgentId={agents.displayAgentId}
          onChatAgentChange={agents.onChatAgentChange}
          chatAgentDisabled
        />
        <main className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-12 sm:px-6">
          <div className="w-full">
            <AgentRunErrorBanner errorText={stream.error!} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-panel">
      <ChatRealtimeStatus />

      {!embedded ? <ChatPageHeaderRegistration
        chatHeadline={chatHeadline}
        chatAgents={agents.chatAgents?.items ?? []}
        showChatAgentSelector={agents.showChatAgentSelector}
        chatAgentId={agents.displayAgentId}
        onChatAgentChange={agents.onChatAgentChange}
        chatAgentDisabled={isSessionTransitioning}
        sessionKey={session.sessionKey}
        workspacePath={session.effectiveWorkspacePath}
        canChangeWorkspace={canChangeWorkingDirectory}
        workspaceDisabled={isSessionTransitioning || stream.sending || stream.streaming}
        onWorkspaceChange={session.onSessionWorkingDirectoryChange}
      /> : null}

      <div className={cn('relative mx-auto flex min-h-0 w-full flex-1 flex-col', embedded ? 'max-w-none' : 'max-w-[calc(var(--max-width-chat)+8rem)]')}>
        {!embedded && scopedProject ? (
          <ChatProjectScopeBar
            project={scopedProject}
            workspace={session.effectiveWorkspacePath}
            projectLabel={m.chat.scopeProject}
            workspaceLabel={m.chat.scopeWorkspace}
            returnTo={pathname}
          />
        ) : null}
        {(location.state as { fromAgentEditor?: boolean } | null)?.fromAgentEditor &&
        agents.displayAgentId ? (
          <div className="shrink-0 border-b border-edge-subtle bg-surface-panel/80 px-3 py-1.5 sm:px-5 xl:px-6">
            <Link
              to={agentsAppDetailPath(agents.displayAgentId)}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-fg"
            >
              <span aria-hidden>←</span>
              {m.agentsSettings.backToEditor}
            </Link>
          </div>
        ) : null}
        {sourceNoteId ? (
          <div className="shrink-0 border-b border-edge-subtle bg-surface-panel/80 px-3 py-1.5 sm:px-5 xl:px-6">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <span className="min-w-0 truncate">
                {m.chat.sourceNoteBanner.replace('{{title}}', sourceNoteTitle)}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-edge-subtle px-2 font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  onClick={handleDraftSourceNoteDigest}
                >
                  <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
                  <span>{m.chat.sourceNoteDigestAction}</span>
                </button>
                <Link
                  to={withDetailReturnTo(`/notes/${encodeURIComponent(sourceNoteId)}`, `${location.pathname}${location.search}`)}
                  className="font-medium text-accent transition-colors hover:text-accent-fg"
                >
                  {m.chat.sourceNoteOpen}
                </Link>
              </div>
            </div>
          </div>
        ) : null}
        <div className={cn('relative flex min-h-0 min-w-0 flex-1', embedded ? 'px-3' : 'px-3 sm:px-5 xl:px-6')}>
          {!embedded ? <ChatTimelinePanel
            items={timeline.items}
            activeMessageIndex={activeMessageIndex + timelineDisplayOffset}
            labels={timelineLabels}
            openLabel={m.chat.timelineOpen}
            closeLabel={m.chat.timelineClose}
            currentLabel={m.chat.timelineCurrent}
            onSelectMessage={handleTimelineSelect}
          /> : null}
          {!embedded ? <div className="absolute inset-y-0 right-0 hidden xl:block">
            <ChatTimelineRail
              items={timeline.items}
              activeMessageIndex={activeMessageIndex + timelineDisplayOffset}
              labels={timelineLabels}
              onSelectMessage={handleTimelineSelect}
            />
          </div> : null}
          <div className={cn('mx-auto flex min-h-0 min-w-0 flex-1 flex-col', !embedded && 'xl:max-w-[58rem]')}>
            <div
              ref={scrollRef}
              className={cn(
                'chat-messages min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]',
                compactWelcomeLayout ? 'chat-messages--compact-welcome pt-5 pb-2' : 'py-4',
              )}
              onScroll={handleChatScroll}
            >
              {isLoadingHistory ? (
                <div className="flex min-h-[min(40vh,20rem)] w-full flex-col gap-10 py-8" aria-busy="true">
                  <div className="flex justify-end">
                    <Skeleton className="h-11 w-[min(70%,22rem)] rounded-2xl" />
                  </div>
                  <div className="flex flex-col gap-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-[min(82%,36rem)]" />
                    <Skeleton className="h-4 w-[min(74%,32rem)]" />
                    <Skeleton className="h-4 w-[min(48%,22rem)]" />
                  </div>
                  <div className="flex justify-end">
                    <Skeleton className="h-11 w-[min(62%,18rem)] rounded-2xl" />
                  </div>
                </div>
              ) : (
                <>
                  {session.loadingMore ? (
                    <div className="mb-3 text-center text-xs text-fg-muted">{m.chat.loadOlder}</div>
                  ) : null}
                  {stream.error ? (
                    <div
                      className={cn(
                        'sticky z-20 shrink-0 bg-transparent pe-2',
                        compactWelcomeLayout ? '-top-5' : '-top-4',
                      )}
                    >
                      <AgentRunErrorBanner errorText={stream.error} />
                    </div>
                  ) : null}
                  {!embedded && taskId ? <TaskSessionBanner taskId={taskId} /> : null}
                  {workflowRunLinks.length > 0 ? (
                    <div className="mb-6 flex flex-col gap-3">
                      {workflowRunLinks.map((link) => (
                        <WorkflowRunLinkCard key={link.id} link={link} />
                      ))}
                    </div>
                  ) : null}
                  {showWorkflowLiveBanner && workflowRunView ? (
                    <WorkflowSessionBanner
                      view={workflowRunView}
                      sessionKey={chatSessionKey}
                      onAbortCurrentTurn={stream.abort}
                    />
                  ) : null}
                  {!embedded && chatSessionKey ? (
                    <ProductAutomationFeedback
                      eventType="session.transcript.updated"
                      source="sessions"
                      payloadKey="sessionKey"
                      payloadValue={chatSessionKey}
                      className="mb-6"
                    />
                  ) : null}
                  <MessageList
                    messages={msgSlice.items}
                    authToken={token ?? undefined}
                    sessionKey={session.decodedKey ?? session.sessionKey}
                    projectId={scopedProject?.id}
                    streaming={stream.streaming}
                    progress={stream.progress}
                    reasoningLevel={session.reasoningLevel}
                    registerListContentRef={registerListContentRef}
                    onPickWelcomePrompt={onPickWelcomePrompt}
                    welcomeSpotlight={activeWelcomeSpotlight}
                    welcomeOverlay={
                      welcomeContextLoading ? (
                        <ChatWelcomeSpotlightSkeleton showSkeleton={showWelcomeSkeleton} />
                      ) : undefined
                    }
                    onRetryWelcomeContext={welcomeContextState.retry}
                    onRefreshWelcomeExploration={
                      activeWelcomeSpotlight?.categories.some((category) => category.scope === 'explore')
                        ? refreshWelcomeExploration
                        : undefined
                    }
                    onSelectWelcomeProject={selectWelcomeProject}
                    onDeleteRound={taskId ? undefined : stream.deleteMessageRound}
                    onRetryUserMessageRound={taskId ? undefined : stream.retryUserMessageRound}
                    deleteRoundDisabled={stream.streaming || stream.sending}
                    onEditUserMessage={taskId ? undefined : handleEditUserMessage}
                    editLatestUserOnly
                    editRequiresTurnId
                    onSaveAssistantAsNote={handleSaveAssistantAsNote}
                    onSaveAssistantToSourceNote={sourceNoteId ? handleSaveAssistantToSourceNote : undefined}
                    onExtractAssistantTask={sourceNoteId ? handleExtractAssistantTask : undefined}
                  />
                </>
              )}
            </div>

            <div
              className={cn(
                'sticky bottom-0 z-10 shrink-0 bg-surface-panel',
                compactWelcomeLayout ? 'py-2.5' : 'py-4',
              )}
            >
              {chatSessionKey ? <MemoryCaptureReceipt sessionKey={chatSessionKey} language={language} /> : null}
              {chatSessionKey ? <MemoryCandidatePrompt sessionKey={chatSessionKey} language={language} /> : null}
              {chatSessionKey ? <MemoryConsentPrompt sessionKey={chatSessionKey} language={language} /> : null}
              <ClarifyPrompt
                prompt={clarify.clarifyPrompt}
                submitting={clarify.clarifySubmitting}
                submitError={clarify.clarifySubmitError}
                labels={m.chat}
                onSubmit={clarify.submitClarifyAnswer}
                onCancel={clarify.cancelClarifyAnswer}
              />
              {latestConversationPlan ? (
                <ConversationPlanDock
                  plan={latestConversationPlan.plan}
                  changeSummary={latestConversationPlan.changeSummary}
                  isStreaming={stream.streaming}
                  labels={{
                    heading: m.chat.planHeading,
                    stepProgress: m.chat.planStepProgress,
                    completedProgress: m.chat.planCompletedProgress,
                    finished: m.chat.planFinished,
                    ended: m.chat.planEnded,
                    planned: m.chat.planPlanned,
                    filesChangedOne: m.chat.planFilesChanged_one,
                    filesChangedOther: m.chat.planFilesChanged_other,
                  }}
                />
              ) : null}
              <ChatComposer
                disabled={
                  isSessionTransitioning ||
                  Boolean(clarify.clarifyPrompt)
                }
                sending={stream.sending}
                streaming={stream.streaming}
                sessionKey={session.sessionKey}
                welcomeDraftSeed={welcomeDraftSeed}
                welcomeSuggestion={compactWelcomeLayout ? primaryWelcomeSelection : null}
                onAcceptWelcomeSuggestion={onPickWelcomePrompt}
                thinkingLevel={session.thinkingLevel}
                modelSupportsThinking={session.modelSupportsThinking}
                onThinkingChange={session.onSessionThinkingLevelChange}
                onSend={handleComposerSend}
                editingUserTurnId={editingUserTurn?.turnId}
                onCancelUserMessageEdit={handleCancelUserMessageEdit}
                onAbort={stream.abort}
                onAddPendingFollowUp={followUp.addPendingFollowUp}
                onSteeringInterrupt={(text, atts) => void stream.interruptAndSend(text, atts)}
                pendingFollowUps={followUp.pendingFollowUps}
                editingFollowUpId={followUp.editingFollowUpId}
                onBeginEditFollowUp={followUp.beginEditFollowUp}
                onCancelEditFollowUp={followUp.cancelEditFollowUp}
                onCommitEditFollowUp={(id, text, atts, level) =>
                  void followUp.commitEditFollowUp(id, text, atts, level)
                }
                onPendingFollowUpRemove={followUp.removePendingFollowUp}
                onPendingFollowUpMove={followUp.movePendingFollowUp}
                onPendingFollowUpReorder={followUp.reorderPendingFollowUp}
                onPendingFollowUpSteer={(id) => void followUp.steerPendingFollowUp(id)}
                steeringFollowUpId={followUp.steeringFollowUpId}
                sessionModel={session.sessionModel}
                showModelSelector
                onModelChange={session.onSessionModelChange}
                modelDisabled={
                  isSessionTransitioning || stream.streaming
                }
                onChatAgentChange={
                  !taskId && agents.showChatAgentSelector ? agents.onChatAgentChange : undefined
                }
                currentAgentId={agents.displayAgentId}
              />
            </div>
          </div>
        </div>
        {!embedded && chatSessionKey && window.electronAPI?.terminal ? (
          <Suspense fallback={null}>
            <ChatTerminalDock key={chatSessionKey} sessionKey={chatSessionKey} />
          </Suspense>
        ) : null}
      </div>

      <Dialog.Root
        open={sourceNoteSaveDraft !== null}
        onOpenChange={(open) => {
          if (!open && !sourceNoteSaveSubmitting) closeSourceNoteSaveDialog();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(82vh,42rem)] w-[min(100%-2rem,44rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover outline-none">
            <div className="shrink-0 border-b border-edge-subtle px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">
                {m.chat.sourceNoteSaveDialogTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {m.chat.sourceNoteSaveDialogDescription.replace('{{title}}', sourceNoteTitle)}
              </Dialog.Description>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              {sourceNoteSaveError ? <p className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{m.chat.sourceNoteSaveFailed}: {sourceNoteSaveError}</p> : null}
              <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
                <span>{m.chat.sourceNoteSaveDialogHeadingLabel}</span>
                <input
                  value={sourceNoteSaveDraft?.heading ?? ''}
                  onChange={(event) =>
                    setSourceNoteSaveDraft((draft) =>
                      draft ? { ...draft, heading: event.target.value } : draft,
                    )
                  }
                  className="h-10 rounded-lg border border-edge bg-surface-base px-3 text-sm font-normal text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
                  disabled={sourceNoteSaveSubmitting}
                />
              </label>
              <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-sm font-medium text-fg">
                <span>{m.chat.sourceNoteSaveDialogContentLabel}</span>
                <textarea
                  value={sourceNoteSaveDraft?.content ?? ''}
                  onChange={(event) =>
                    setSourceNoteSaveDraft((draft) =>
                      draft ? { ...draft, content: event.target.value } : draft,
                    )
                  }
                  className="min-h-[18rem] flex-1 resize-none rounded-lg border border-edge bg-surface-base px-3 py-2 font-mono text-xs leading-relaxed text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
                  disabled={sourceNoteSaveSubmitting}
                />
              </label>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={closeSourceNoteSaveDialog}
                disabled={sourceNoteSaveSubmitting}
              >
                {m.chat.sourceNoteSaveDialogCancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleConfirmSourceNoteSave()}
                disabled={sourceNoteSaveSubmitting || !sourceNoteSaveDraft?.content.trim()}
              >
                {sourceNoteSaveSubmitting
                  ? m.chat.sourceNoteSaveDialogSaving
                  : m.chat.sourceNoteSaveDialogConfirm}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ScrollToBottomButton
        visible={!session.showSessionLoading && !atBottom}
        onClick={() => scrollToBottom(true)}
      />

    </div>
  );
}
