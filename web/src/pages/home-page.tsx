import * as Dialog from '@radix-ui/react-dialog';
import type {
  HomeAction,
  HomeCapabilityPreflight,
  HomeDelivery,
  HomeOpportunity,
  HomeOpportunityActionRequest,
  HomeOpportunityFeedbackRequest,
  HomeWorkbenchItem,
} from '@xopcai/gateway-contract';
import { CalendarClock, Check, ChevronDown, ChevronRight, CirclePause, CircleAlert, Plus, Search, Sparkles, X } from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';


import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MAX_CHAT_ATTACHMENTS } from '@/features/chat/attachments/attachment-utils';
import { collectClipboardFiles } from '@/features/chat/composer/composer-clipboard';
import { appendTranscriptToDraft } from '@/features/chat/composer/append-transcript-to-draft';
import { createComposerPayloadHandoff } from '@/features/chat/composer/composer-payload-handoff';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import { useRealtimeVoice } from '@/features/voice/realtime/use-realtime-voice';
import { newChatAutoSendHref } from '@/features/chat/session/composer-handoff-params';
import {
  acknowledgeWorkAttention,
  actOnHomeOpportunity,
  refreshHomeAdvisor,
  respondToWorkDecision,
  retryWorkAttention,
  submitHomeOpportunityFeedback,
  undoHomeOpportunityFeedback,
  type TaskDetail,
} from '@/features/tasks/home-api';
import { useHomeSnapshot } from '@/features/tasks/use-home-snapshot';
import { HomeQuickComposer } from '@/features/tasks/home-quick-composer';
import { HomeAdvisorCard, type HomeAdvisorReceipt } from '@/features/tasks/home-advisor-card';
import { HomeAdvisorHistoryDialog } from '@/features/tasks/home-advisor-history-dialog';
import { HomeAdvisorStatusControl, type HomeAdvisorStatusCopy } from '@/features/tasks/home-advisor-status-control';
import { modalizeTaskDetailHref } from '@/features/tasks/task-detail-route';
import { HomeDeliveriesDialog, HomeDeliveryRow } from '@/features/tasks/home-deliveries';
import { currentTaskReceipt } from '@/features/tasks/task-detail-summary';
import { HomeTaskReview } from '@/features/tasks/home-task-review';
import { retryHomeTask } from '@/features/tasks/home-task-actions';
import { taskCopy } from '@/features/tasks/task-copy';
import {
  type VoiceInputShortcutTarget,
  VOICE_INPUT_CANCEL_EVENT,
  VOICE_INPUT_TOGGLE_EVENT,
} from '@/features/voice/voice-input-shortcut-events';
import { messages } from '@/i18n/messages';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

const READ_DELIVERIES_KEY = 'xopc-home-read-deliveries';

function loadReadDeliveries(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(READ_DELIVERIES_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string').slice(0, 300) : [];
  } catch {
    return [];
  }
}

function HomeSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <div className="space-y-3">
        <Skeleton className="h-10 w-3/5 rounded-xl" />
        <Skeleton className="h-5 w-4/5 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-32 rounded-xl" />
    </div>
  );
}

type HomeActionRunner = (action: HomeAction, itemId: string) => void;

function DecisionCard({
  item,
  busy,
  primary,
  dueLabel,
  failureLabel,
  locale,
  onAction,
  onComplete,
  onUpdated,
}: {
  item: HomeWorkbenchItem;
  busy: boolean;
  primary: boolean;
  dueLabel: string;
  failureLabel: string;
  locale: 'en' | 'zh';
  onAction: HomeActionRunner;
  onComplete: () => void;
  onUpdated: (detail: TaskDetail) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskMatch = item.openAction?.type === 'open' ? /^\/tasks\/([^/?#]+)/.exec(item.openAction.href) : null;
  const reviewTaskId = item.primaryAction?.type === 'task_review' ? item.primaryAction.taskId
    : taskMatch ? decodeURIComponent(taskMatch[1]) : undefined;
  const reviewOpen = Boolean(reviewTaskId && searchParams.get('reviewTask') === reviewTaskId);
  const setReviewOpen = (open: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (open && reviewTaskId) next.set('reviewTask', reviewTaskId);
    else next.delete('reviewTask');
    setSearchParams(next);
  };
  const [scopeOpen, setScopeOpen] = useState(false);
  const work = messages(locale).projectsPage.home.workbench;
  const authorization = item.primaryAction?.type === 'connector_decision';
  const due = item.dueAt !== undefined ? `${dueLabel} ${formatMediumDateTime(item.dueAt, locale)}` : null;
  const subtitle = [item.projectName, authorization ? item.summary.split('\n')[0] : item.summary].filter(Boolean).join(' · ');
  const expandReview = Boolean(reviewTaskId && (item.primaryAction?.type === 'task_review' || item.primaryAction?.type === 'open'));
  return (
    <article className="px-3 py-3 sm:px-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 basis-52">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {item.openAction ? (
              <button type="button" className="break-words text-left text-sm font-semibold text-fg hover:underline" onClick={() => onAction(item.openAction!, item.id)}>{item.title}</button>
            ) : <span className="break-words text-sm font-semibold text-fg">{item.title}</span>}
            {due || item.kind === 'failure' ? <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">{due ?? failureLabel}</span> : null}
          </div>
          <p className="mt-0.5 line-clamp-2 break-words text-xs text-fg-muted">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {reviewTaskId && item.primaryAction?.type === 'retry_task' ? (
            <Button variant="ghost" className="min-h-9 px-2 text-xs" aria-expanded={reviewOpen} onClick={() => setReviewOpen(!reviewOpen)}>{locale === 'zh' ? '查看结果与依据' : 'View result and evidence'}</Button>
          ) : null}
          {item.primaryAction ? (
            <Button
              type="button"
              variant={primary ? 'primary' : 'secondary'}
              className="min-h-9 shrink-0 px-2.5 text-xs shadow-none"
              disabled={busy}
              aria-expanded={authorization ? scopeOpen : expandReview ? reviewOpen : undefined}
              onClick={() => {
                if (authorization) setScopeOpen((open) => !open);
                else if (expandReview) setReviewOpen(!reviewOpen);
                else onAction(item.primaryAction!, item.id);
              }}
            >
              {authorization ? work.viewScope : item.primaryAction.label}
            </Button>
          ) : null}
        </div>
      </div>
      {authorization && scopeOpen ? (
        <div className="mt-3 space-y-2 rounded-lg bg-surface-inset px-3 py-2">
          <p className="whitespace-pre-wrap break-words text-xs text-fg-muted">{item.summary}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => onAction(item.primaryAction!, item.id)}>{item.primaryAction?.label}</Button>
            {item.secondaryActions.map((action) => <Button key={action.label} disabled={busy} onClick={() => onAction(action, item.id)}>{action.label}</Button>)}
          </div>
        </div>
      ) : null}
      {!authorization && !expandReview && item.secondaryActions.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {item.secondaryActions.filter((action) => action.type !== 'open').map((action) => (
            <Button key={action.label} variant="ghost" disabled={busy} onClick={() => onAction(action, item.id)}>{action.label}</Button>
          ))}
        </div>
      ) : null}
      {reviewOpen && reviewTaskId ? <HomeTaskReview key={reviewTaskId} taskId={reviewTaskId} language={locale} onUpdated={onUpdated} onComplete={() => { setReviewOpen(false); onComplete(); }} /> : null}
    </article>
  );
}

function BackgroundRow({ item, onAction, language, onUpdated }: { item: HomeWorkbenchItem; onAction: HomeActionRunner; language: 'zh' | 'en'; onUpdated: (detail: TaskDetail) => void }) {
  const [expanded, setExpanded] = useState(false);
  const taskMatch = item.openAction?.type === 'open' ? /^\/tasks\/([^/?#]+)/.exec(item.openAction.href) : null;
  const taskId = taskMatch ? decodeURIComponent(taskMatch[1]) : undefined;
  const icon = item.kind === 'scheduled'
    ? <CalendarClock className="size-4" aria-hidden />
    : item.backgroundState === 'paused' ? <CirclePause className="size-4" aria-hidden />
      : <span className="size-1.5 rounded-full bg-fg-subtle" aria-hidden />;
  return (
    <div>
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 py-2 text-left hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        disabled={!item.openAction}
        aria-expanded={taskId ? expanded : undefined}
        onClick={() => taskId ? setExpanded((value) => !value) : item.openAction && onAction(item.openAction, item.id)}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-fg-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block line-clamp-2 break-words text-sm font-medium text-fg">{item.title}</span>
          {item.kind === 'scheduled' ? <time className="block text-xs text-fg-muted" dateTime={new Date(item.updatedAt).toISOString()}>{formatMediumDateTime(item.updatedAt, language)}</time>
            : <span className="block truncate text-xs text-fg-muted">{item.summary}</span>}
        </span>
        {item.openAction ? <span className="flex shrink-0 items-center gap-0.5 text-xs text-accent-fg"><span>{item.openAction.label}</span><ChevronRight className="size-3.5" aria-hidden /></span> : null}
      </button>
      {taskId && expanded ? <HomeTaskReview taskId={taskId} language={language} onUpdated={onUpdated} onComplete={() => setExpanded(false)} /> : null}
    </div>
  );
}

export function HomePage() {
  const language = useLocaleStore((state) => state.language);
  const msg = messages(language);
  const t = msg.projectsPage;
  const copy = taskCopy(language);
  const navigate = useNavigate();
  const location = useLocation();
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const { home, loading, loadError, setLoadError, load } = useHomeSnapshot(language, location.key, true);
  const work = t.home.workbench;
  const stageRef = useRef<HTMLDivElement>(null);
  const [deliveryView, setDeliveryView] = useState<HomeDelivery | 'history' | null>(null);
  const [readDeliveries, setReadDeliveries] = useState(loadReadDeliveries);
  const resultTrigger = useRef<HTMLElement | null>(null);
  const [suggestionExpanded, setSuggestionExpanded] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const actionPendingRef = useRef(false);
  const [actionReceipt, setActionReceipt] = useState<{ message: string; href?: string; item?: HomeWorkbenchItem; slot?: number }>();
  const [showAllBackground, setShowAllBackground] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [advisorBusy, setAdvisorBusy] = useState(false);
  const [advisorReceipt, setAdvisorReceipt] = useState<HomeAdvisorReceipt>();
  const [advisorHistoryOpen, setAdvisorHistoryOpen] = useState(false);
  const [advisorHistoryRefreshKey, setAdvisorHistoryRefreshKey] = useState(0);
  const [advisorUndo, setAdvisorUndo] = useState<{
    opportunityId: string;
    idempotencyKey: string;
  }>();
  const [advisorPreflight, setAdvisorPreflight] = useState<{
    opportunityId: string;
    value: HomeCapabilityPreflight;
  }>();
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachments = useComposerAttachments({ chat: msg.chat });
  const intentInputRef = useRef<HTMLTextAreaElement>(null);
  const voice = useRealtimeVoice({
    disabled: attachmentBusy,
    chat: msg.chat,
    onTranscript: (transcript) => {
      setIntent((current) => appendTranscriptToDraft(current, transcript));
      window.setTimeout(() => intentInputRef.current?.focus(), 0);
    },
  });
  const {
    phase: voicePhase,
    voiceActive,
    startVoiceInput,
    cancelVoiceInput: cancelVoiceCapture,
    confirmVoiceInput,
    retryVoiceInput,
  } = voice;

  useEffect(() => {
    if (!advisorUndo) return;
    const timer = window.setTimeout(() => setAdvisorUndo(undefined), 8_000);
    return () => window.clearTimeout(timer);
  }, [advisorUndo]);

  const processAttachmentFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      await attachments.processFiles(files);
    } finally {
      setAttachmentBusy(false);
    }
  }, [attachmentBusy, attachments.processFiles]);

  const handleAttachmentPaste = useCallback(async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const collected = collectClipboardFiles(event.clipboardData);
    if (collected.length === 0) return;
    event.preventDefault();
    await processAttachmentFiles(collected);
  }, [processAttachmentFiles]);

  const handleAttachmentDragOver = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    attachments.setIsDragging(true);
  }, [attachments.setIsDragging]);

  const handleAttachmentDragLeave = useCallback((event: DragEvent<HTMLFormElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      attachments.setIsDragging(false);
    }
  }, [attachments.setIsDragging]);

  const handleAttachmentDrop = useCallback(async (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    attachments.setIsDragging(false);
    await processAttachmentFiles(Array.from(event.dataTransfer.files));
  }, [attachments.setIsDragging, processAttachmentFiles]);

  const startConversation = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const wireAttachments = attachments.wireAttachmentsPayload();
    const attachmentsHandoff = wireAttachments.length > 0
      ? createComposerPayloadHandoff(wireAttachments)
      : undefined;
    const href = newChatAutoSendHref(intent, attachmentsHandoff, { projectScope: 'none' });
    if (!href) return;
    setConversationOpen(false);
    setIntent('');
    attachments.clearAttachments();
    navigate(href);
  }, [attachments.clearAttachments, attachments.wireAttachmentsPayload, intent, navigate]);

  const attachmentsFull = attachments.attachments.length >= MAX_CHAT_ATTACHMENTS;
  const attachTitle = attachmentsFull
    ? interpolate(msg.chat.maxAttachmentsReached, { max: MAX_CHAT_ATTACHMENTS })
    : `${msg.chat.attachFile} (${attachments.attachments.length}/${MAX_CHAT_ATTACHMENTS})`;
  const quickComposerLabels = {
    attachTitle,
    dropFiles: msg.chat.dropFiles,
    intentLabel: copy.intentLabel,
    intentPlaceholder: copy.intentPlaceholder,
    intentSuggestion: copy.intentSuggestion,
    shortcut: t.home.submitShortcut,
    submit: copy.newWork,
  };
  const advisorStatusCopy = useMemo<HomeAdvisorStatusCopy>(() => ({
    label: t.home.advisorStatusLabel,
    ready: t.home.advisorStatusReady,
    clarification: t.home.advisorStatusClarification,
    refreshing: t.home.advisorStatusRefreshing,
    refreshingDetail: t.home.advisorRefreshing,
    idle: t.home.advisorStatusIdle,
    idleDetail: t.home.advisorUnavailableTitle,
    generationFailed: t.home.advisorStatusGenerationFailed,
    budgetExhausted: t.home.advisorStatusBudgetExhausted,
    modelUnavailable: t.home.advisorStatusModelUnavailable,
    generationFailedDetail: t.home.advisorGenerationFailed,
    budgetExhaustedDetail: t.home.advisorBudgetExhausted,
    modelUnavailableDetail: t.home.advisorModelUnavailable,
    history: t.home.advisorHistory,
    retry: t.home.retry,
    findAnother: t.home.advisorRefresh,
  }), [t.home]);

  const deliveries = (home?.recentDeliveries ?? []).map((item) => readDeliveries.includes(item.id) ? { ...item, read: true } : item);
  const now = Date.now();
  const unreadDeliveries = deliveries.filter((item) => !item.read && item.completedAt >= now - 7 * 24 * 60 * 60_000);
  const resumable = home?.resumable ?? [];
  const needsUserCount = (home?.needsUser.length ?? 0)
    + (home?.attentionPolicy?.suppressedAttentionCount ?? 0) + (home?.attentionPolicy?.suppressedDecisionCount ?? 0);
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const dueToday = home?.needsUser.filter((item) => item.dueAt !== undefined && item.dueAt >= now && item.dueAt < nextMidnight.getTime()).length ?? 0;
  const background = home?.background ?? [];
  const moving = background.filter((item) => item.kind !== 'scheduled');
  const scheduled = background.filter((item) => item.kind === 'scheduled');
  const advisorVisible = home?.advisor.state === 'ready' || home?.advisor.state === 'clarification' || Boolean(advisorReceipt);
  useEffect(() => {
    if (!advisorReceipt) return;
    const timer = window.setTimeout(() => setAdvisorReceipt(undefined), 8_000);
    return () => window.clearTimeout(timer);
  }, [advisorReceipt]);
  const mode = !home ? undefined : needsUserCount > 0 ? 'attention' : unreadDeliveries.length > 0 ? 'delivery'
    : resumable.length > 0 || moving.length > 0 || home.runningConversations?.length || advisorVisible ? 'resume' : 'idle';
  const isIdle = mode === 'idle';
  const showInlineComposer = isIdle && !conversationOpen;
  const composerVisible = showInlineComposer || conversationOpen;
  const previousMode = useRef(mode);
  const focusAfterWork = useRef(false);

  useLayoutEffect(() => {
    const previous = previousMode.current;
    previousMode.current = mode;
    if (!previous || !mode || mode === previous) return;
    if (focusAfterWork.current) {
      focusAfterWork.current = false;
      if (document.activeElement === document.body) stageRef.current?.focus({ preventScroll: true });
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const animation = stageRef.current?.animate?.(
      [{ opacity: 0.7, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 180, easing: 'ease-out' },
    );
    return () => animation?.cancel();
  }, [mode]);

  useEffect(() => {
    const syncReadDeliveries = (event: StorageEvent) => {
      if (event.key === READ_DELIVERIES_KEY || event.key === null) setReadDeliveries(loadReadDeliveries());
    };
    window.addEventListener('storage', syncReadDeliveries);
    return () => window.removeEventListener('storage', syncReadDeliveries);
  }, []);

  const rememberDelivery = useCallback((id: string) => {
    setReadDeliveries((current) => [...new Set([id, ...current])].slice(0, 300));
    try {
      localStorage.setItem(READ_DELIVERIES_KEY, JSON.stringify([...new Set([id, ...loadReadDeliveries()])].slice(0, 300)));
    } catch { /* A blocked storage provider still allows this tab to acknowledge results. */ }
  }, []);

  useEffect(() => {
    if (!composerVisible && voiceActive) cancelVoiceCapture();
  }, [cancelVoiceCapture, composerVisible, voiceActive]);

  useEffect(() => {
    const toggleVoiceInput = (event: Event) => {
      const target = (event as CustomEvent<{ target?: VoiceInputShortcutTarget }>).detail?.target;
      if ((target && target !== 'chat') || !composerVisible || attachmentBusy) return;
      event.preventDefault();
      if (voicePhase === 'recording') {
        confirmVoiceInput();
      } else if (voicePhase === 'idle') {
        intentInputRef.current?.focus();
        void startVoiceInput();
      } else if (voicePhase === 'error') {
        retryVoiceInput();
      }
    };
    const handleCancelVoiceInput = (event: Event) => {
      const target = (event as CustomEvent<{ target?: VoiceInputShortcutTarget }>).detail?.target;
      if ((target && target !== 'chat') || !composerVisible || !voiceActive) return;
      event.preventDefault();
      cancelVoiceCapture();
      intentInputRef.current?.focus();
    };

    window.addEventListener(VOICE_INPUT_TOGGLE_EVENT, toggleVoiceInput);
    window.addEventListener(VOICE_INPUT_CANCEL_EVENT, handleCancelVoiceInput);
    return () => {
      window.removeEventListener(VOICE_INPUT_TOGGLE_EVENT, toggleVoiceInput);
      window.removeEventListener(VOICE_INPUT_CANCEL_EVENT, handleCancelVoiceInput);
    };
  }, [
    attachmentBusy,
    cancelVoiceCapture,
    composerVisible,
    confirmVoiceInput,
    retryVoiceInput,
    startVoiceInput,
    voiceActive,
    voicePhase,
  ]);

  const handleConversationOpenChange = useCallback((open: boolean) => {
    if (!open) cancelVoiceCapture();
    setConversationOpen(open);
  }, [cancelVoiceCapture]);

  const runAction = useCallback<HomeActionRunner>((action, itemId) => {
    if (action.type === 'open') {
      navigate(modalizeTaskDetailHref('/', action.href));
      return;
    }
    if (action.type === 'task_review' || actionPendingRef.current) return;
    actionPendingRef.current = true;
    setBusyItemId(itemId);
    const slot = home?.needsUser.findIndex((item) => item.id === itemId) ?? -1;
    const resolved = slot < 0 ? undefined : { item: home?.needsUser[slot], slot };
    setActionReceipt(undefined);
    setLoadError(null);
    void (async () => {
      try {
        if (action.type === 'retry_task') {
          await retryHomeTask(action.taskId, language);
          setActionReceipt({ ...resolved, message: language === 'zh' ? '任务已重新开始，可查看执行进度。' : 'Task restarted. View progress.', href: modalizeTaskDetailHref('/', `/tasks/${encodeURIComponent(action.taskId)}`) });
        } else if (action.type === 'connector_decision') {
          await respondToWorkDecision({ kind: 'connector_approval', approvalId: action.approvalId }, action.decision);
          setActionReceipt({ ...resolved, message: language === 'zh' ? (action.decision === 'approve' ? '已批准授权，任务状态将自动更新。' : '已拒绝授权。') : (action.decision === 'approve' ? 'Permission approved. Task status will update.' : 'Permission denied.') });
        } else if (action.type === 'retry_run') {
          const result = await retryWorkAttention({ kind: action.subjectKind, runId: action.runId });
          setActionReceipt({ ...resolved, message: language === 'zh' ? '已发起重试，可查看新的执行结果。' : 'Retry started. Follow the new execution.', href: result.conversationId ? `/chat/${encodeURIComponent(result.conversationId)}` : `/automations?run=${encodeURIComponent(result.runId)}` });
        } else if (action.type === 'acknowledge_run') {
          await acknowledgeWorkAttention({ kind: action.subjectKind, runId: action.runId });
          setActionReceipt({ ...resolved, message: language === 'zh' ? '已确认此异常，已从待处理事项移除。' : 'Issue acknowledged and removed from pending items.' });
        }
        focusAfterWork.current = true;
        await load();
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        actionPendingRef.current = false;
        setBusyItemId(null);
      }
    })();
  }, [home, language, load, navigate]);

  const onTaskUpdated = useCallback((detail: TaskDetail, item?: HomeWorkbenchItem) => {
    const result = detail.task.phase === 'closed' && detail.task.resolution === 'done' ? currentTaskReceipt(detail) : undefined;
    if (result) rememberDelivery(`task:${result.runId}`);
    focusAfterWork.current = true;
    const slot = item ? home?.needsUser.findIndex((entry) => entry.id === item.id) : undefined;
    setActionReceipt({
      item, slot,
      message: language === 'zh'
        ? (detail.task.phase === 'closed' ? '任务已验收完成。' : '操作已保存，任务状态已更新。')
        : (detail.task.phase === 'closed' ? 'Task accepted.' : 'Action saved. Task status updated.'),
      href: modalizeTaskDetailHref('/', `/tasks/${encodeURIComponent(detail.task.id)}`),
    });
    void load();
  }, [home, language, load, rememberDelivery]);

  const refreshAdvisor = useCallback(() => {
    setAdvisorBusy(true);
    setAdvisorReceipt(undefined);
    setAdvisorPreflight(undefined);
    setLoadError(null);
    void refreshHomeAdvisor(language)
      .then(() => load())
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setAdvisorBusy(false));
  }, [language, load]);

  const actOnAdvisor = useCallback((opportunity: HomeOpportunity, mode: HomeOpportunityActionRequest['mode']) => {
    setAdvisorBusy(true);
    setLoadError(null);
    void actOnHomeOpportunity(opportunity, mode)
      .then(async (result) => {
        if (result.outcome === 'needs_setup') {
          setAdvisorPreflight({ opportunityId: opportunity.id, value: result.preflight });
          return;
        }
        setAdvisorPreflight(undefined);
        setAdvisorHistoryRefreshKey((value) => value + 1);
        if (result.outcome === 'task') {
          setAdvisorReceipt({
            title: t.home.advisorStartedTitle,
            detail: interpolate(t.home.advisorStartedDetail, { title: opportunity.title }),
            href: modalizeTaskDetailHref('/', result.href),
          });
          await load();
          return;
        }
        navigate(result.href);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setAdvisorBusy(false));
  }, [load, navigate, t.home.advisorStartedDetail, t.home.advisorStartedTitle]);

  const sendAdvisorFeedback = useCallback((
    opportunity: HomeOpportunity,
    kind: HomeOpportunityFeedbackRequest['kind'],
  ) => {
    setAdvisorBusy(true);
    setAdvisorReceipt(undefined);
    setAdvisorPreflight(undefined);
    setLoadError(null);
    const snoozedUntil = kind === 'too_early' ? Date.now() + 3 * 24 * 60 * 60_000 : undefined;
    void submitHomeOpportunityFeedback(opportunity, { kind, snoozedUntil })
      .then(({ idempotencyKey }) => {
        setAdvisorUndo({ opportunityId: opportunity.id, idempotencyKey });
        setAdvisorHistoryRefreshKey((value) => value + 1);
        return load();
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setAdvisorBusy(false));
  }, [load]);

  const undoAdvisorFeedback = useCallback(() => {
    if (!advisorUndo) return;
    const pending = advisorUndo;
    setAdvisorUndo(undefined);
    setAdvisorBusy(true);
    setLoadError(null);
    void undoHomeOpportunityFeedback(pending.opportunityId, pending.idempotencyKey)
      .then(() => {
        setAdvisorHistoryRefreshKey((value) => value + 1);
        return load();
      })
      .catch((error) => {
        setAdvisorUndo(pending);
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setAdvisorBusy(false));
  }, [advisorUndo, load]);

  const discussClarification = useCallback((question: string, answer: string) => {
    navigate(`/chat/new?${new URLSearchParams({ draft: `${question}\n\n${answer}` }).toString()}`);
  }, [navigate]);

  const headerEnd = useMemo(() => (
    <div className="flex items-center gap-1">
      {home && !isIdle ? (
        <HomeAdvisorStatusControl
          advisor={home.advisor}
          busy={advisorBusy}
          copy={advisorStatusCopy}
          onOpenHistory={() => setAdvisorHistoryOpen(true)}
          onRefresh={refreshAdvisor}
        />
      ) : null}
      {!isIdle ? (
        <Button type="button" variant="secondary" className="h-9 rounded-lg" onClick={() => setConversationOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {copy.newWork}
        </Button>
      ) : null}
    </div>
  ), [advisorBusy, advisorStatusCopy, copy.newWork, home, isIdle, refreshAdvisor]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>,
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, setPageHeader, t.title]);

  const openDelivery = (view: HomeDelivery | 'history') => {
    resultTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeliveryView(view);
  };
  const finishDelivery = (item: HomeDelivery) => {
    rememberDelivery(item.id);
    setDeliveryView(null);
    setActionReceipt({ message: work.deliverySaved });
    void load();
  };
  const visibleAttention = showAllAttention ? (home?.needsUser ?? []) : (home?.needsUser.slice(0, 2) ?? []);
  const remainingAttention = needsUserCount - visibleAttention.length;
  const handled = actionReceipt?.item && !home?.needsUser.some((item) => item.id === actionReceipt.item?.id)
    && (actionReceipt.slot ?? Infinity) < 2 ? actionReceipt.item : undefined;
  const attentionRows = [...visibleAttention];
  if (handled) attentionRows.splice(actionReceipt?.slot ?? 0, 0, handled);
  const runningChats = (home?.runningConversations ?? []).map<HomeWorkbenchItem>((run) => ({
    id: run.runId, kind: 'running', title: run.title ?? (language === 'zh' ? '对话正在执行' : 'Conversation in progress'),
    summary: work.inProgress, updatedAt: run.updatedAt, secondaryActions: [],
    openAction: { type: 'open', label: work.inProgress, href: `/chat/${encodeURIComponent(run.conversationId)}` },
  }));
  const liveBackground = [...moving, ...runningChats].sort((a, b) => b.updatedAt - a.updatedAt);
  const advisorCompact = mode === 'attention' && !advisorReceipt && !suggestionExpanded;
  const advisorTitle = home?.advisor.state === 'ready' ? home.advisor.primary.title
    : home?.advisor.state === 'clarification' ? home.advisor.question.question : undefined;

  const deliverySection = unreadDeliveries.length > 0 ? (
    <section className="space-y-2" aria-labelledby="home-delivery-title">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3">
        <h2 id="home-delivery-title" className="text-base font-semibold text-fg">{work.progress}</h2>
        <Button variant="ghost" className="px-2 text-xs" onClick={() => openDelivery('history')}>{work.deliveryHistory}</Button>
      </div>
      <div className="divide-y divide-edge-subtle rounded-xl border border-edge-subtle bg-surface-panel">
        {unreadDeliveries.slice(0, mode === 'attention' ? 1 : 3).map((item, index) => (
          <HomeDeliveryRow key={item.id} item={item} language={language} showNew primary={mode === 'delivery' && index === 0} onOpen={() => openDelivery(item)} />
        ))}
      </div>
    </section>
  ) : null;
  const backgroundGroups = [
    { title: work.inProgress, items: liveBackground.filter((item) => !item.backgroundState && !item.statusLabel) },
    { title: work.waiting, items: liveBackground.filter((item) => item.backgroundState === 'waiting' || (!item.backgroundState && item.statusLabel)) },
    { title: work.paused, items: liveBackground.filter((item) => item.backgroundState === 'paused') },
    { title: work.scheduled, items: scheduled },
  ].filter((group) => group.items.length > 0);
  const backgroundLimit = mode === 'attention' ? 1 : 3;
  const backgroundSection = backgroundGroups.length ? (
    <section className="min-w-0 space-y-2" aria-labelledby="home-background-title">
      <div className="flex min-h-9 items-center">
        <h2 id="home-background-title" className="text-base font-semibold text-fg">{work.background}</h2>
      </div>
      <div className="divide-y divide-edge-subtle rounded-xl border border-edge-subtle bg-surface-panel">
        {backgroundGroups.map(({ title, items }) => (
          <div key={title} className="px-3 py-2">
            <h3 className="px-1 pt-1 text-xs font-medium text-fg-muted">{title}</h3>
            <div className="divide-y divide-edge-subtle">
              {(showAllBackground ? items : items.slice(0, backgroundLimit)).map((item) => <BackgroundRow key={item.id} item={item} language={language} onAction={runAction} onUpdated={onTaskUpdated} />)}
            </div>
          </div>
        ))}
        {backgroundGroups.some(({ items }) => items.length > backgroundLimit) ? (
          <Button variant="ghost" className="w-full justify-start rounded-t-none px-4 text-xs" aria-expanded={showAllBackground} onClick={() => setShowAllBackground((value) => !value)}>
            {language === 'zh' ? (showAllBackground ? '收起' : `查看全部 ${liveBackground.length + scheduled.length} 项`) : (showAllBackground ? 'Show less' : `View all ${liveBackground.length + scheduled.length} items`)}
          </Button>
        ) : null}
      </div>
    </section>
  ) : null;
  const hasPrimary = needsUserCount > 0 || unreadDeliveries.length > 0 || resumable.length > 0 || advisorVisible;

  return (
    <div className="@container/workbench flex w-full min-w-0 flex-1 flex-col px-3 pb-6 pt-3 sm:px-4">
      <input
        ref={attachments.fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files;
          if (files) void processAttachmentFiles(Array.from(files));
          event.target.value = '';
        }}
      />
      <Dialog.Root
        open={conversationOpen}
        onOpenChange={handleConversationOpenChange}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(31rem,calc(100dvh-1.5rem))] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float focus:outline-none">
            <div className="flex shrink-0 items-start gap-4 border-b border-edge px-5 py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-fg">{copy.dialogTitle}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-5 text-fg-muted">{copy.dialogDescription}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="-mr-2 -mt-1 size-8 shrink-0 rounded-lg p-0" title={t.cancel} aria-label={t.cancel}>
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <HomeQuickComposer
              variant="dialog"
              inputId="new-conversation-intent"
              inputRef={intentInputRef}
              intent={intent}
              labels={{ ...quickComposerLabels, submit: copy.submit }}
              attachments={attachments.attachments}
              isDragging={attachments.isDragging}
              attachmentBusy={attachmentBusy}
              attachmentsFull={attachmentsFull}
              voice={voice}
              chat={msg.chat}
              cancelAction={(
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost">{t.cancel}</Button>
                </Dialog.Close>
              )}
              onIntentChange={setIntent}
              onPickFiles={() => attachments.fileInputRef.current?.click()}
              onRemoveAttachment={attachments.removeAttachment}
              onPaste={(event) => void handleAttachmentPaste(event)}
              onDragOver={handleAttachmentDragOver}
              onDragLeave={handleAttachmentDragLeave}
              onDrop={(event) => void handleAttachmentDrop(event)}
              onSubmit={startConversation}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <HomeAdvisorHistoryDialog
        open={advisorHistoryOpen}
        refreshKey={advisorHistoryRefreshKey}
        onOpenChange={setAdvisorHistoryOpen}
        onReevaluate={refreshAdvisor}
      />

      {loadError ? (
        <div role="alert" className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{loadError}</span>
          <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => void load()}>{t.home.retry}</Button>
        </div>
      ) : null}

      <HomeDeliveriesDialog
        view={deliveryView}
        items={deliveries}
        language={language}
        onSelect={setDeliveryView}
        onClose={() => setDeliveryView(null)}
        onRead={finishDelivery}
        onOpenFull={(item) => { setDeliveryView(null); navigate(modalizeTaskDetailHref('/', item.href)); }}
        onRestoreFocus={() => {
          const target = resultTrigger.current?.isConnected ? resultTrigger.current : stageRef.current;
          target?.focus({ preventScroll: true });
        }}
      />

      <div role="status">
        {actionReceipt ? (
          <div className="mb-3 flex w-full flex-wrap items-center justify-between gap-2 rounded-lg bg-success-soft px-3 py-1.5 text-xs text-fg">
            <span>{actionReceipt.message}</span>
            {actionReceipt.href ? <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => navigate(actionReceipt.href!)}>{language === 'zh' ? '查看进展与结果' : 'View progress and result'}</Button> : null}
          </div>
        ) : null}
      </div>

      {loading ? <HomeSkeleton /> : home ? (
        <div ref={stageRef} tabIndex={-1} className="flex min-h-0 w-full flex-1 flex-col gap-4 outline-none">
          {needsUserCount === 0 ? <p className="text-xs font-medium text-fg-muted" aria-live="polite">{work.noAttention}</p> : null}
          {showInlineComposer ? (
            <section className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center pb-12 pt-10 text-center sm:pb-20 sm:pt-16">
              <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{work.startTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{work.startHint}</p>
              <HomeQuickComposer
                variant="inline"
                inputId="home-conversation-intent"
                inputRef={intentInputRef}
                intent={intent}
                labels={{ ...quickComposerLabels, intentPlaceholder: work.startExample }}
                attachments={attachments.attachments}
                isDragging={attachments.isDragging}
                attachmentBusy={attachmentBusy}
                attachmentsFull={attachmentsFull}
                voice={voice}
                chat={msg.chat}
                onIntentChange={setIntent}
                onPickFiles={() => attachments.fileInputRef.current?.click()}
                onRemoveAttachment={attachments.removeAttachment}
                onPaste={(event) => void handleAttachmentPaste(event)}
                onDragOver={handleAttachmentDragOver}
                onDragLeave={handleAttachmentDragLeave}
                onDrop={(event) => void handleAttachmentDrop(event)}
                onSubmit={startConversation}
              />
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button variant="ghost" onClick={() => window.dispatchEvent(new Event('open-command-palette'))}><Search className="size-4" aria-hidden />{work.findWork}</Button>
                <Button variant="ghost" onClick={() => openDelivery('history')}>{work.deliveryHistory}</Button>
              </div>
            </section>
          ) : null}

          <div className={hasPrimary && backgroundSection ? 'grid min-w-0 items-start gap-5 @min-[56rem]/workbench:grid-cols-[minmax(0,1fr)_minmax(17rem,0.57fr)]' : 'grid min-w-0 gap-4'}>
            {hasPrimary ? <div className="min-w-0 space-y-4">
              {needsUserCount > 0 ? (
                <section className="space-y-2" aria-labelledby="home-needs-user-title">
                  <div className="flex min-h-9 flex-wrap items-center gap-2">
                    <CircleAlert className="size-4 text-warning" aria-hidden />
                    <h2 id="home-needs-user-title" className="text-base font-semibold text-fg">{work.attention}</h2>
                    <span className="rounded-md bg-surface-inset px-1.5 py-0.5 text-xs font-medium tabular-nums text-fg-muted" aria-live="polite" aria-label={interpolate(t.home.attentionTitle, { count: needsUserCount })}>{needsUserCount}</span>
                    {dueToday > 0 ? <span className="text-xs text-warning">{interpolate(work.dueToday, { count: dueToday })}</span> : null}
                  </div>
                  <div className="divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel">
                    {attentionRows.map((item, index) => item === handled ? (
                      <div key={item.id} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 text-sm text-fg-muted">
                        <span>{item.title}</span><Check className="size-4 shrink-0 text-success" aria-label={language === 'zh' ? '已处理' : 'Handled'} />
                      </div>
                    ) : (
                      <DecisionCard
                        key={item.id}
                        item={item}
                        primary={index === 0 || (index === 1 && attentionRows[0] === handled)}
                        busy={busyItemId !== null}
                        dueLabel={t.home.dueLabel}
                        failureLabel={copy.runAttention}
                        locale={language}
                        onAction={runAction}
                        onComplete={() => void load()}
                        onUpdated={(detail) => onTaskUpdated(detail, item)}
                      />
                    ))}
                    {showAllAttention || remainingAttention > 0 ? (
                      <Button variant="ghost" className="w-full justify-start rounded-t-none px-4 text-xs" aria-expanded={showAllAttention} onClick={() => setShowAllAttention((value) => !value)}>
                        <ChevronDown className={showAllAttention ? 'size-4 rotate-180' : 'size-4'} aria-hidden />
                        {showAllAttention ? work.collapse : interpolate(work.remaining, { count: remainingAttention })}
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {deliverySection}


              {resumable.length > 0 || advisorVisible ? (
                <section className="space-y-2" aria-labelledby="home-resume-title">
                  <h2 id="home-resume-title" className="flex min-h-9 items-center text-base font-semibold text-fg">{work.resume}</h2>
                  {resumable.length > 0 ? (
                    <div className="divide-y divide-edge-subtle rounded-xl border border-edge-subtle bg-surface-panel">
                      {resumable.slice(0, mode === 'attention' ? 1 : 3).map((item) => (
                        <div key={`${item.kind}:${item.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1 basis-48">
                            <p className="break-words text-sm font-semibold text-fg">{item.title}</p>
                            <p className="mt-0.5 truncate text-xs text-fg-muted">{[item.projectName, item.summary || interpolate(work.lastActive, { time: formatMediumDateTime(item.updatedAt, language) })].filter(Boolean).join(' · ')}</p>
                          </div>
                          <Button variant="secondary" onClick={() => navigate(modalizeTaskDetailHref('/', item.href))}>{item.kind === 'task' ? work.continueTask : work.continueChat}</Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {advisorTitle && mode === 'attention' && !advisorReceipt ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-inset px-3 py-1">
                      <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-fg-muted"><Sparkles className="size-4 shrink-0 text-accent" aria-hidden /><span className="truncate">{t.home.advisorStatusLabel} · {advisorTitle}</span></p>
                      <Button variant="ghost" aria-expanded={suggestionExpanded} onClick={() => setSuggestionExpanded((value) => !value)}>{suggestionExpanded ? work.hideSuggestion : work.viewSuggestion}</Button>
                    </div>
                  ) : null}
                  {advisorVisible && !advisorCompact ? (
                    <HomeAdvisorCard
                      advisor={home.advisor}
                      busy={advisorBusy}
                      copy={{
                        aiLabel: t.home.advisorAiLabel,
                        why: t.home.advisorWhy,
                        evidence: t.home.advisorEvidence,
                        needsSetup: t.home.advisorNeedsSetup,
                        start: t.home.advisorStart,
                        discuss: t.home.advisorDiscuss,
                        refresh: t.home.advisorRefresh,
                        refreshing: t.home.advisorRefreshing,
                        history: t.home.advisorHistory,
                        viewProgress: t.home.advisorViewProgress,
                        alternatives: t.home.advisorAlternatives,
                        more: work.moreSuggestionActions,
                        feedback: t.home.advisorFeedback,
                        alreadyDone: t.home.advisorAlreadyDone,
                        irrelevant: t.home.advisorIrrelevant,
                        later: t.home.advisorLater,
                        lessLikeThis: t.home.advisorLessLikeThis,
                        sourceIncorrect: t.home.advisorSourceIncorrect,
                        minutes: t.home.advisorMinutes,
                        setupTitle: t.home.advisorSetupTitle,
                        setupHint: t.home.advisorSetupHint,
                        configure: t.home.advisorConfigure,
                        degradedStart: t.home.advisorDegradedStart,
                        automationHint: t.home.advisorAutomationHint,
                        automationAction: t.home.advisorAutomationAction,
                      }}
                      onRefresh={refreshAdvisor}
                      onAction={actOnAdvisor}
                      onFeedback={sendAdvisorFeedback}
                      onClarification={discussClarification}
                      onOpenHistory={() => setAdvisorHistoryOpen(true)}
                      preflight={advisorPreflight}
                      receipt={advisorReceipt}
                    />
                  ) : null}
                </section>
              ) : null}

            </div> : null}
            {backgroundSection}
          </div>
          {!isIdle && !deliverySection && deliveries.length > 0 ? (
            <Button variant="ghost" className="self-start px-2 text-xs" onClick={() => openDelivery('history')}>{work.deliveryHistory}</Button>
          ) : null}
        </div>
      ) : null}
      {advisorUndo ? (
        <div role="status" className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-4 rounded-lg border border-edge bg-surface-overlay px-4 py-3 text-sm text-fg shadow-float">
          <span>{t.home.advisorFeedbackSaved}</span>
          <button type="button" className="font-medium text-accent-fg hover:underline" onClick={undoAdvisorFeedback}>
            {t.home.advisorUndo}
          </button>
        </div>
      ) : null}
    </div>
  );
}
