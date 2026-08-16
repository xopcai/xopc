import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BriefcaseBusiness, ChevronDown, FileText, Target } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { fetchCommandsCached } from '@/features/chat/palette/command-palette-api';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatComposer } from '@/features/chat/composer/chat-composer';
import { ChatProjectScopeBar } from '@/features/chat/scope/chat-project-scope-bar';
import { useChatProjectScope } from '@/features/chat/scope/use-chat-project-scope';
import { ChatWelcomeSpotlightSkeleton } from '@/features/chat/chat-welcome-spotlight';
import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { ChatSseStatus } from '@/features/chat/agent-selection/chat-sse-status';
import { ConversationPlanDock } from '@/features/chat/messages/conversation-plan-dock';
import { extractLatestConversationPlan } from '@/features/chat/messages/conversation-plan';
import { MessageList } from '@/features/chat/messages/message-list';
import { ScrollToBottomButton } from '@/features/chat/scroll/scroll-to-bottom-button';
import { useChatScrollViewport } from '@/features/chat/scroll/use-chat-scroll-viewport';
import { useChatSession } from '@/features/chat/session/use-chat-session';
import { buildComposerDraftSeed } from '@/features/chat/session/composer-handoff-params';
import { ChatTimelinePanel } from '@/features/chat/timeline/chat-timeline-panel';
import { ChatTimelineRail } from '@/features/chat/timeline/chat-timeline-rail';
import { ClarifyPrompt } from '@/features/chat/composer/clarify-prompt';
import { MemoryCaptureReceipt, MemoryConsentPrompt } from '@/features/chat/composer/memory-consent-prompt';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { wireTextForSlashCommandEntry } from '@/features/chat/palette/slash-command-wire-text';
import { WorkflowRunLinkCard } from '@/features/chat/workflow/workflow-run-link-card';
import { WorkflowSessionBanner } from '@/features/chat/workflow/workflow-session-banner';
import { useWelcomeSuggestionContext } from '@/features/chat/welcome/use-welcome-suggestion-context';
import {
  buildWelcomeSpotlight,
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
import { useWorkflowSessionMetadata } from '@/features/workflows/use-workflow-session-metadata';
import { appendNoteContent, createTaskNote, getNote } from '@/features/notes/notes-api';
import { withReturnTo } from '@/lib/navigation-return';
import {
  applyWorkItemUpdateSuggestion,
  createWorkItemUpdateSuggestion,
  dismissWorkItemUpdateSuggestion,
  fetchWorkItem,
  type WorkItem,
  type WorkItemStatus,
  type WorkItemUpdateSuggestion,
} from '@/features/work-items/api';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { useChatRunPresenceStore } from '@/features/chat/session/chat-run-presence-store';
import { AgentRunErrorBanner } from '@/features/chat/messages/agent-run-error-banner';
import { parseAgentRunError } from '@/features/chat/messages/agent-run-error-parser';
import { agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { showToast } from '@/lib/toast';
import { showActivity } from '@/stores/activity-store';
import { Button } from '@/components/ui/button';

type PendingSourceNoteSave = {
  sourceNoteId: string;
  resolve: () => void;
  reject: () => void;
};

type SourceNoteSaveDraft = {
  heading: string;
  content: string;
};

type WorkItemUpdateDraft = {
  statusEnabled: boolean;
  status: WorkItemStatus | '';
  nextActionEnabled: boolean;
  nextAction: string;
  blockedReasonEnabled: boolean;
  blockedReason: string;
  progressNoteEnabled: boolean;
  progressNote: string;
  rationale: string;
  suggestion?: WorkItemUpdateSuggestion;
};

const WORK_ITEM_STATUS_OPTIONS: WorkItemStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'needs_input',
  'in_review',
  'done',
  'cancelled',
];

function compactAssistantText(content: string, max = 1400): string {
  return content
    .replace(/```[\s\S]*?```/g, (block) => block.slice(0, 400))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
    .trim();
}

function extractLineAfterLabel(text: string, labels: string[]): string {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^[-*#>\s]+/, '').trim());
  for (const line of lines) {
    for (const label of labels) {
      const pattern = new RegExp(`^${label}\\s*[:：-]\\s*(.+)$`, 'i');
      const match = line.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return '';
}

function inferSuggestedStatus(text: string): WorkItemStatus | '' {
  const lower = text.toLowerCase();
  if (/needs?\s+(user\s+)?input|需要.*(确认|输入|反馈)/i.test(text)) return 'needs_input';
  if (/blocked|blocker|无法继续|阻塞|卡住/i.test(text)) return 'blocked';
  if (/ready\s+for\s+review|in\s+review|等待.*(检查|验收|review)|待验收/i.test(text)) return 'in_review';
  if (/done|completed|已完成|完成了/i.test(text)) return 'in_review';
  if (lower.includes('next step') || text.includes('下一步')) return 'in_progress';
  return '';
}

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

function buildWorkItemUpdateDraft(content: string): WorkItemUpdateDraft {
  const progressNote = compactAssistantText(content);
  const nextAction = extractLineAfterLabel(content, ['next action', 'next step', '下一步', '后续动作']);
  const blockedReason = extractLineAfterLabel(content, ['blocked reason', 'blocker', '阻塞', '阻塞原因']);
  const status = inferSuggestedStatus(content);
  return {
    statusEnabled: Boolean(status),
    status,
    nextActionEnabled: Boolean(nextAction),
    nextAction,
    blockedReasonEnabled: Boolean(blockedReason),
    blockedReason,
    progressNoteEnabled: Boolean(progressNote),
    progressNote,
    rationale: '',
  };
}

export function ChatPage() {
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
  const pendingSourceNoteSaveRef = useRef<PendingSourceNoteSave | null>(null);
  const [welcomeDraftSeed, setWelcomeDraftSeed] = useState<{ id: number; text: string } | null>(null);
  const [welcomeAffinity, setWelcomeAffinity] = useState<Record<string, number>>(() =>
    readWelcomeSuggestionAffinity(),
  );
  const [welcomeExplorationOffset, setWelcomeExplorationOffset] = useState(0);
  const [sourceNoteLoadedTitle, setSourceNoteLoadedTitle] = useState<string | null>(null);
  const [sourceWorkItem, setSourceWorkItem] = useState<WorkItem | null>(null);
  const [sourceWorkItemLoadState, setSourceWorkItemLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [workItemContextExpanded, setWorkItemContextExpanded] = useState(false);
  const [workItemUpdateDraft, setWorkItemUpdateDraft] = useState<WorkItemUpdateDraft | null>(null);
  const [workItemUpdateSubmitting, setWorkItemUpdateSubmitting] = useState(false);
  const [sourceNoteSaveDraft, setSourceNoteSaveDraft] = useState<SourceNoteSaveDraft | null>(null);
  const [sourceNoteSaveSubmitting, setSourceNoteSaveSubmitting] = useState(false);
  const [showWelcomeSkeleton, setShowWelcomeSkeleton] = useState(false);

  const { auth, session, messages: msgSlice, timeline, stream, followUp, clarify, agents } = useChatSession();

  const skillQuery = searchParams.get('skill')?.trim() ?? '';
  const slashQuery = searchParams.get('slash')?.trim() ?? '';
  const draftQuery = searchParams.get('draft') ?? '';
  const autoSendQuery = searchParams.get('autoSend') === '1';
  const chatSessionKey = session.decodedKey ?? session.sessionKey;
  const markChatRunViewed = useChatRunPresenceStore((state) => state.markViewed);
  useEffect(() => {
    if (chatSessionKey) markChatRunViewed(chatSessionKey);
  }, [chatSessionKey, markChatRunViewed]);
  const { data: workflowMeta } = useWorkflowSessionMetadata(chatSessionKey);
  const workflowRunId = workflowMeta?.workflowRunId ?? null;
  const workflowOwnerAgentId = workflowMeta?.ownerAgentId ?? undefined;
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
    setWelcomeAffinity(readWelcomeSuggestionAffinity());
  }, [session.sessionKey]);

  const onPickWelcomePrompt = useCallback((selection: WelcomeSuggestionSelection) => {
    pendingWelcomeSelectionRef.current = selection;
    recordWelcomeSuggestionMetric({
      type: 'pick',
      suggestionId: selection.suggestionId,
      categoryId: selection.categoryId,
      contextKind: selection.contextKind,
    });
    welcomeDraftSeq.current += 1;
    setWelcomeDraftSeed({ id: welcomeDraftSeq.current, text: selection.prompt });
  }, []);
  const refreshWelcomeExploration = useCallback(() => {
    setWelcomeExplorationOffset((value) => value + 1);
  }, []);
  const selectWelcomeProject = useCallback(
    async (projectId: string) => {
      await session.createNewSession({ projectId });
    },
    [session.createNewSession],
  );

  const canSelectWorkingDirectory = useMemo(
    () =>
      Boolean(session.sessionKey) &&
      !session.showSessionLoading &&
      !session.sessionRoutePending &&
      !session.workingDirectoryLocked &&
      msgSlice.items.length === 0,
    [
      session.sessionKey,
      session.showSessionLoading,
      session.sessionRoutePending,
      session.workingDirectoryLocked,
      msgSlice.items.length,
    ],
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
    () => extractLatestConversationPlan(msgSlice.items),
    [msgSlice.items],
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

  const sourceNoteId = workflowMeta?.sourceNoteId ?? null;
  const sourceWorkItemId = workflowMeta?.sourceWorkItemId ?? null;
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

  useEffect(() => {
    let cancelled = false;
    setSourceWorkItem(null);
    setSourceWorkItemLoadState(sourceWorkItemId ? 'loading' : 'idle');
    setWorkItemContextExpanded(false);
    if (!sourceWorkItemId) return undefined;
    void fetchWorkItem(sourceWorkItemId)
      .then((result) => {
        if (!cancelled) {
          setSourceWorkItem(result.item);
          setSourceWorkItemLoadState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSourceWorkItem(null);
          setSourceWorkItemLoadState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceWorkItemId]);

  const sourceNoteTitle =
    sourceNoteLoadedTitle || workflowMeta?.sourceNoteTitle || m.chat.sourceNoteFallbackTitle;
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
    sourceWorkItem,
    sourceContextPending: Boolean(sourceWorkItemId) && sourceWorkItemLoadState === 'loading',
    sourceContextFailed: Boolean(sourceWorkItemId) && sourceWorkItemLoadState === 'error',
    effectiveWorkspacePath: session.effectiveWorkspacePath,
    workingDirectoryLocked:
      session.workspaceSource === 'session_override' || session.workspaceSource === 'agent_workspace',
    sessionManager: session.sessionManager,
  });
  const welcomeAgent = useMemo(
    () =>
      agents.chatAgents?.items.find((item) => item.id === agents.displayAgentId) ?? {
        id: agents.displayAgentId,
      },
    [agents.chatAgents?.items, agents.displayAgentId],
  );
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
    });
  }, [activeWelcomeSpotlight, chatSessionKey, msgSlice.items.length, stream.streaming]);

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
          edited: selection.prompt.trim() !== text.trim(),
          characterDelta: text.length - selection.prompt.length,
        });
      }
      pendingWelcomeSelectionRef.current = null;
      return stream.sendMessage(...args);
    },
    [stream.sendMessage],
  );

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

  const handleConfirmSourceNoteSave = useCallback(async () => {
    const pending = pendingSourceNoteSaveRef.current;
    if (!pending || !sourceNoteSaveDraft) return;
    const heading = sourceNoteSaveDraft.heading.trim() || m.chat.sourceNoteAppendHeading;
    const content = sourceNoteSaveDraft.content.trim();
    if (!content) return;

    setSourceNoteSaveSubmitting(true);
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
      showToast({
        type: 'error',
        title: m.chat.sourceNoteSaveFailed,
        message: err instanceof Error ? err.message : undefined,
      });
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
        showToast({
          type: 'error',
          title: m.chat.sourceNoteTaskFailed,
          message: err instanceof Error ? err.message : undefined,
        });
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

  const sendWorkItemPrompt = useCallback((prompt: string) => {
    if (stream.streaming || stream.sending) {
      void followUp.addPendingFollowUp(prompt);
      return;
    }
    void stream.sendMessage(prompt);
  }, [followUp, stream]);

  const handleSummarizeWorkItemProgress = useCallback(() => {
    if (!sourceWorkItem) return;
    sendWorkItemPrompt(m.chat.workItemSummarizePrompt.replace('{{title}}', sourceWorkItem.title));
  }, [m.chat.workItemSummarizePrompt, sendWorkItemPrompt, sourceWorkItem]);

  const handlePlanWorkItemNextStep = useCallback(() => {
    if (!sourceWorkItem) return;
    sendWorkItemPrompt(m.chat.workItemNextStepPrompt.replace('{{title}}', sourceWorkItem.title));
  }, [m.chat.workItemNextStepPrompt, sendWorkItemPrompt, sourceWorkItem]);

  const handleSuggestWorkItemUpdate = useCallback(
    async (content: string) => {
      if (!sourceWorkItem || !chatSessionKey) return;
      setWorkItemUpdateDraft(buildWorkItemUpdateDraft(content));
    },
    [chatSessionKey, sourceWorkItem],
  );

  const closeWorkItemUpdateDialog = useCallback(() => {
    const suggestion = workItemUpdateDraft?.suggestion;
    if (suggestion?.status === 'pending') {
      void dismissWorkItemUpdateSuggestion(suggestion.id).catch(() => undefined);
    }
    setWorkItemUpdateDraft(null);
    setWorkItemUpdateSubmitting(false);
  }, [workItemUpdateDraft?.suggestion]);

  const handleApplyWorkItemUpdate = useCallback(async () => {
    if (!sourceWorkItem || !chatSessionKey || !workItemUpdateDraft) return;
    const patch = {
      ...(workItemUpdateDraft.statusEnabled && workItemUpdateDraft.status ? { status: workItemUpdateDraft.status } : {}),
      ...(workItemUpdateDraft.nextActionEnabled ? { nextAction: workItemUpdateDraft.nextAction.trim() || null } : {}),
      ...(workItemUpdateDraft.blockedReasonEnabled ? { blockedReason: workItemUpdateDraft.blockedReason.trim() || null } : {}),
    };
    const progressNote = workItemUpdateDraft.progressNoteEnabled
      ? workItemUpdateDraft.progressNote.trim()
      : '';
    if (Object.keys(patch).length === 0 && !progressNote) return;

    setWorkItemUpdateSubmitting(true);
    try {
      const existing = workItemUpdateDraft.suggestion;
      const suggestion = existing ?? (await createWorkItemUpdateSuggestion(sourceWorkItem.id, {
        sourceKind: 'chat',
        sourceId: chatSessionKey,
        patch,
        progressNote: progressNote || undefined,
        rationale: workItemUpdateDraft.rationale.trim() || undefined,
      })).suggestion;
      const result = await applyWorkItemUpdateSuggestion(suggestion.id);
      setSourceWorkItem(result.item);
      setWorkItemUpdateDraft(null);
    } catch (err) {
      showToast({
        type: 'error',
        title: m.chat.workItemUpdateFailed,
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setWorkItemUpdateSubmitting(false);
    }
  }, [chatSessionKey, m.chat.workItemUpdateFailed, sourceWorkItem, workItemUpdateDraft]);

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
        <ChatSseStatus />
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
      <ChatSseStatus />

      <ChatPageHeaderRegistration
        chatHeadline={chatHeadline}
        chatAgents={agents.chatAgents?.items ?? []}
        showChatAgentSelector={agents.showChatAgentSelector}
        chatAgentId={agents.displayAgentId}
        onChatAgentChange={agents.onChatAgentChange}
        chatAgentDisabled={isSessionTransitioning}
      />

      <div className="relative mx-auto flex min-h-0 w-full max-w-[calc(var(--max-width-chat)+8rem)] flex-1 flex-col">
        {scopedProject ? (
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
                  to={`/notes/${encodeURIComponent(sourceNoteId)}`}
                  className="font-medium text-accent transition-colors hover:text-accent-fg"
                >
                  {m.chat.sourceNoteOpen}
                </Link>
              </div>
            </div>
          </div>
        ) : null}
        {sourceWorkItem ? (
          <div className="shrink-0 border-b border-edge-subtle bg-surface-panel/90 px-3 py-1.5 sm:px-5 xl:px-6">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                onClick={() => setWorkItemContextExpanded((open) => !open)}
                aria-expanded={workItemContextExpanded}
              >
                <BriefcaseBusiness className="size-3.5 shrink-0 text-accent-fg" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 truncate">
                  {m.chat.workItemBanner.replace('{{title}}', sourceWorkItem.title)}
                </span>
                <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] text-fg-muted">
                  {sourceWorkItem.status.replace(/_/g, ' ')}
                </span>
                <ChevronDown
                  className={cn('size-3.5 shrink-0 transition-transform', workItemContextExpanded ? 'rotate-180' : '')}
                  strokeWidth={1.75}
                  aria-hidden
                />
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-edge-subtle px-2 font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  onClick={handlePlanWorkItemNextStep}
                >
                  <Target className="size-3.5" strokeWidth={1.75} aria-hidden />
                  <span>{m.chat.workItemNextStepAction}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-edge-subtle px-2 font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  onClick={handleSummarizeWorkItemProgress}
                >
                  <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
                  <span>{m.chat.workItemSummarizeAction}</span>
                </button>
                <Link
                  to={withReturnTo(`/work-items/${encodeURIComponent(sourceWorkItem.id)}`, pathname)}
                  className="font-medium text-accent transition-colors hover:text-accent-fg"
                >
                  {m.chat.workItemOpenItem}
                </Link>
                <Link
                  to={withReturnTo(`/projects/${encodeURIComponent(sourceWorkItem.projectId)}/work-items`, pathname)}
                  className="font-medium text-fg-muted transition-colors hover:text-fg"
                >
                  {m.chat.workItemOpenProject}
                </Link>
              </div>
            </div>
            {workItemContextExpanded ? (
              <div className="mt-2 grid gap-2 rounded-md border border-edge-subtle bg-surface-base px-3 py-2 text-xs leading-5 text-fg-muted sm:grid-cols-2">
                <p className="min-w-0">
                  <span className="font-medium text-fg">{m.chat.workItemPriorityLabel}: </span>
                  {sourceWorkItem.priority}
                </p>
                <p className="min-w-0">
                  <span className="font-medium text-fg">{m.chat.workItemUpdatedLabel}: </span>
                  {formatMediumDateTime(new Date(sourceWorkItem.updatedAt))}
                </p>
                {sourceWorkItem.description ? (
                  <p className="min-w-0 sm:col-span-2">
                    <span className="font-medium text-fg">{m.chat.workItemDescriptionLabel}: </span>
                    {sourceWorkItem.description}
                  </p>
                ) : null}
                {sourceWorkItem.nextAction ? (
                  <p className="min-w-0">
                    <span className="font-medium text-fg">{m.chat.workItemNextActionLabel}: </span>
                    {sourceWorkItem.nextAction}
                  </p>
                ) : null}
                {sourceWorkItem.blockedReason ? (
                  <p className="min-w-0">
                    <span className="font-medium text-fg">{m.chat.workItemBlockedLabel}: </span>
                    {sourceWorkItem.blockedReason}
                  </p>
                ) : null}
                {!sourceWorkItem.description && !sourceWorkItem.nextAction && !sourceWorkItem.blockedReason ? (
                  <p className="min-w-0 sm:col-span-2">{m.chat.workItemNoDetails}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="relative flex min-h-0 min-w-0 flex-1 px-3 sm:px-5 xl:px-6">
          <ChatTimelinePanel
            items={timeline.items}
            activeMessageIndex={activeMessageIndex + timelineDisplayOffset}
            labels={timelineLabels}
            openLabel={m.chat.timelineOpen}
            closeLabel={m.chat.timelineClose}
            currentLabel={m.chat.timelineCurrent}
            onSelectMessage={handleTimelineSelect}
          />
          <div className="absolute inset-y-0 right-0 hidden xl:block">
            <ChatTimelineRail
              items={timeline.items}
              activeMessageIndex={activeMessageIndex + timelineDisplayOffset}
              labels={timelineLabels}
              onSelectMessage={handleTimelineSelect}
            />
          </div>
          <div className="mx-auto flex min-h-0 min-w-0 flex-1 flex-col xl:max-w-[58rem]">
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
                  {chatSessionKey ? (
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
                    onRefreshWelcomeExploration={refreshWelcomeExploration}
                    onSelectWelcomeProject={selectWelcomeProject}
                    onDeleteRound={stream.deleteMessageRound}
                    onRetryUserMessageRound={stream.retryUserMessageRound}
                    deleteRoundDisabled={stream.streaming || stream.sending}
                    onSaveAssistantToSourceNote={sourceNoteId ? handleSaveAssistantToSourceNote : undefined}
                    onExtractAssistantTask={sourceNoteId ? handleExtractAssistantTask : undefined}
                    onSuggestWorkItemUpdate={sourceWorkItem ? handleSuggestWorkItemUpdate : undefined}
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
                sessionManager={session.sessionManager}
                welcomeDraftSeed={welcomeDraftSeed}
                welcomeSuggestion={compactWelcomeLayout ? primaryWelcomeSelection : null}
                onAcceptWelcomeSuggestion={onPickWelcomePrompt}
                canSelectWorkingDirectory={canSelectWorkingDirectory}
                thinkingLevel={session.thinkingLevel}
                modelSupportsThinking={session.modelSupportsThinking}
                onThinkingChange={session.onSessionThinkingLevelChange}
                reasoningLevel={session.reasoningLevel}
                activityDetailDefault={session.activityDetailDefault}
                activityDetailOverride={session.activityDetailOverride}
                onReasoningChange={session.onSessionReasoningLevelChange}
                onSend={handleComposerSend}
                onAbort={stream.abort}
                onAddPendingFollowUp={(text, atts) => void followUp.addPendingFollowUp(text, atts)}
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
                contextUsageMessages={msgSlice.items}
                onChatAgentChange={
                  agents.showChatAgentSelector ? agents.onChatAgentChange : undefined
                }
                currentAgentId={agents.displayAgentId}
              />
            </div>
          </div>
        </div>
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

      <Dialog.Root
        open={workItemUpdateDraft !== null}
        onOpenChange={(open) => {
          if (!open && !workItemUpdateSubmitting) closeWorkItemUpdateDialog();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed right-0 top-0 z-[90] flex h-dvh w-[min(100%,32rem)] flex-col overflow-hidden border-l border-edge bg-surface-panel shadow-popover outline-none">
            <div className="shrink-0 border-b border-edge-subtle px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">
                {m.chat.workItemUpdateDialogTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {sourceWorkItem
                  ? m.chat.workItemUpdateDialogDescription.replace('{{title}}', sourceWorkItem.title)
                  : m.chat.workItemUpdateDialogDescriptionFallback}
              </Dialog.Description>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <label className="flex items-start gap-3 rounded-lg border border-edge-subtle bg-surface-base p-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={Boolean(workItemUpdateDraft?.statusEnabled)}
                  onChange={(event) =>
                    setWorkItemUpdateDraft((draft) => draft ? { ...draft, statusEnabled: event.target.checked } : draft)
                  }
                  disabled={workItemUpdateSubmitting}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">{m.chat.workItemUpdateStatusLabel}</span>
                  <Select
                    value={workItemUpdateDraft?.status ?? ''}
                    onChange={(event) =>
                      setWorkItemUpdateDraft((draft) => draft ? { ...draft, status: event.target.value as WorkItemStatus | '' } : draft)
                    }
                    disabled={workItemUpdateSubmitting || !workItemUpdateDraft?.statusEnabled}
                    className="h-9 rounded-lg border border-edge bg-surface-panel px-2 text-sm text-fg outline-none focus:border-accent"
                  >
                    <SelectOption value="">{m.chat.workItemUpdateStatusUnchanged}</SelectOption>
                    {WORK_ITEM_STATUS_OPTIONS.map((status) => (
                      <SelectOption key={status} value={status}>{status.replace(/_/g, ' ')}</SelectOption>
                    ))}
                  </Select>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-edge-subtle bg-surface-base p-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={Boolean(workItemUpdateDraft?.nextActionEnabled)}
                  onChange={(event) =>
                    setWorkItemUpdateDraft((draft) => draft ? { ...draft, nextActionEnabled: event.target.checked } : draft)
                  }
                  disabled={workItemUpdateSubmitting}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">{m.chat.workItemUpdateNextActionLabel}</span>
                  <textarea
                    value={workItemUpdateDraft?.nextAction ?? ''}
                    onChange={(event) =>
                      setWorkItemUpdateDraft((draft) => draft ? { ...draft, nextAction: event.target.value } : draft)
                    }
                    disabled={workItemUpdateSubmitting || !workItemUpdateDraft?.nextActionEnabled}
                    className="min-h-20 resize-none rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm leading-6 text-fg outline-none focus:border-accent"
                  />
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-edge-subtle bg-surface-base p-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={Boolean(workItemUpdateDraft?.blockedReasonEnabled)}
                  onChange={(event) =>
                    setWorkItemUpdateDraft((draft) => draft ? { ...draft, blockedReasonEnabled: event.target.checked } : draft)
                  }
                  disabled={workItemUpdateSubmitting}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">{m.chat.workItemUpdateBlockedReasonLabel}</span>
                  <textarea
                    value={workItemUpdateDraft?.blockedReason ?? ''}
                    onChange={(event) =>
                      setWorkItemUpdateDraft((draft) => draft ? { ...draft, blockedReason: event.target.value } : draft)
                    }
                    disabled={workItemUpdateSubmitting || !workItemUpdateDraft?.blockedReasonEnabled}
                    className="min-h-20 resize-none rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm leading-6 text-fg outline-none focus:border-accent"
                  />
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-edge-subtle bg-surface-base p-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={Boolean(workItemUpdateDraft?.progressNoteEnabled)}
                  onChange={(event) =>
                    setWorkItemUpdateDraft((draft) => draft ? { ...draft, progressNoteEnabled: event.target.checked } : draft)
                  }
                  disabled={workItemUpdateSubmitting}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-sm font-medium text-fg">{m.chat.workItemUpdateProgressNoteLabel}</span>
                  <textarea
                    value={workItemUpdateDraft?.progressNote ?? ''}
                    onChange={(event) =>
                      setWorkItemUpdateDraft((draft) => draft ? { ...draft, progressNote: event.target.value } : draft)
                    }
                    disabled={workItemUpdateSubmitting || !workItemUpdateDraft?.progressNoteEnabled}
                    className="min-h-40 resize-none rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm leading-6 text-fg outline-none focus:border-accent"
                  />
                </span>
              </label>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={closeWorkItemUpdateDialog}
                disabled={workItemUpdateSubmitting}
              >
                {m.chat.workItemUpdateDialogCancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleApplyWorkItemUpdate()}
                disabled={workItemUpdateSubmitting}
              >
                {workItemUpdateSubmitting
                  ? m.chat.workItemUpdateDialogApplying
                  : m.chat.workItemUpdateDialogApply}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
