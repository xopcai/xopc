import * as Dialog from '@radix-ui/react-dialog';
import type { HomeAction, HomeFocusItem } from '@xopcai/gateway-contract';
import {
  CalendarClock,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  MessageCircle,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  acknowledgeWorkAttention,
  decideAgentJudgment,
  fetchHome,
  instructAgentJudgment,
  respondToWorkDecision,
  retryWorkAttention,
  createTask,
  transitionAgentJudgment,
  type HomeDecision,
  type HomeResponse,
} from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { messages } from '@/i18n/messages';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

function formatTime(value: string | number | undefined, fallback: string): string {
  if (value == null) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return formatMediumDateTime(date);
}

function CountBadge({ children }: { children: string }) {
  return <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">{children}</span>;
}

function HomeSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-20 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-52 rounded-2xl" />
    </div>
  );
}

type HomeActionRunner = (action: HomeAction, itemId: string) => void;

function focusIcon(kind: HomeFocusItem['kind']) {
  if (kind === 'decision' || kind === 'failure') return <CircleAlert className="size-4" aria-hidden />;
  if (kind === 'result') return <CircleCheck className="size-4" aria-hidden />;
  if (kind === 'scheduled') return <CalendarClock className="size-4" aria-hidden />;
  return <Sparkles className="size-4" aria-hidden />;
}

function actionNeedsDedicatedButton(action: HomeAction | undefined): action is HomeAction {
  return Boolean(action && action.type !== 'open' && action.type !== 'review_judgment');
}

function FocusHero({
  item,
  kindLabel,
  busy,
  onAction,
}: {
  item: HomeFocusItem;
  kindLabel: string;
  busy: boolean;
  onAction: HomeActionRunner;
}) {
  return (
    <section className="rounded-2xl border border-edge-subtle bg-surface-base p-4 shadow-surface sm:p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        <span className={item.kind === 'decision' || item.kind === 'failure' ? 'text-warning' : 'text-accent'}>
          {focusIcon(item.kind)}
        </span>
        <span>{kindLabel}</span>
      </div>
      <button
        type="button"
        className="mt-3 block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
        disabled={!item.openAction}
        onClick={() => item.openAction && onAction(item.openAction, item.id)}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-base font-semibold leading-6 text-fg">{item.title}</span>
            <span className="mt-1 block line-clamp-2 text-sm leading-5 text-fg-muted">{item.summary}</span>
          </span>
          {item.statusLabel ? (
            <span className="shrink-0 rounded-full bg-surface-muted px-2 py-1 text-[11px] font-medium text-fg-muted">
              {item.statusLabel}
            </span>
          ) : null}
        </span>
      </button>
      {item.primaryAction || item.secondaryActions.length > 0 ? (
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-edge-subtle pt-3">
          {item.secondaryActions.map((action) => (
            <Button key={`${action.type}:${action.label}`} type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => onAction(action, item.id)}>
              {action.label}
            </Button>
          ))}
          {item.primaryAction ? (
            <Button type="button" variant="primary" className="h-8 px-3" disabled={busy} onClick={() => onAction(item.primaryAction!, item.id)}>
              {item.primaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FocusRow({ item, busy, onAction }: { item: HomeFocusItem; busy: boolean; onAction: HomeActionRunner }) {
  const quickAction = actionNeedsDedicatedButton(item.primaryAction) ? item.primaryAction : undefined;
  return (
    <article className="flex min-h-16 items-center gap-3 px-3 py-2.5 sm:px-4">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
        disabled={!item.openAction}
        onClick={() => item.openAction && onAction(item.openAction, item.id)}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted">
          {focusIcon(item.kind)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
          <span className="mt-0.5 block truncate text-xs text-fg-muted">{item.summary}</span>
        </span>
        {item.statusLabel ? <span className="max-w-32 shrink-0 truncate text-xs text-fg-subtle">{item.statusLabel}</span> : null}
        {item.openAction ? <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden /> : null}
      </button>
      {quickAction ? (
        <Button type="button" variant="secondary" className="h-8 shrink-0 px-2.5 text-xs" disabled={busy} onClick={() => onAction(quickAction, item.id)}>
          {quickAction.label}
        </Button>
      ) : null}
    </article>
  );
}

function FocusSection({
  title,
  items,
  total,
  viewAllHref,
  viewAllLabel,
  showLessLabel,
  busyItemId,
  onAction,
}: {
  title: string;
  items: HomeFocusItem[];
  total: number;
  viewAllHref?: string;
  viewAllLabel: string;
  showLessLabel: string;
  busyItemId: string | null;
  onAction: HomeActionRunner;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visibleItems = expanded ? items : items.slice(0, 3);
  const canExpandInline = !viewAllHref && items.length > visibleItems.length;
  const showViewAllLink = Boolean(viewAllHref && total > visibleItems.length);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <CountBadge>{total.toLocaleString()}</CountBadge>
        </div>
        {showViewAllLink ? <Link to={viewAllHref!} className="text-xs font-medium text-accent">{viewAllLabel}</Link> : null}
        {canExpandInline || expanded ? (
          <button type="button" className="text-xs font-medium text-accent" onClick={() => setExpanded((value) => !value)}>
            {expanded ? showLessLabel : viewAllLabel}
          </button>
        ) : null}
      </div>
      <div className="divide-y divide-edge-subtle overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base shadow-surface">
        {visibleItems.map((item) => <FocusRow key={item.id} item={item} busy={busyItemId === item.id} onAction={onAction} />)}
      </div>
    </section>
  );
}

function AgentJudgmentCard({
  item,
  labels,
  busy,
  onDecide,
  onSnooze,
  onDismiss,
  onInstruct,
}: {
  item: HomeDecision;
  labels: ReturnType<typeof taskCopy>;
  busy: boolean;
  onDecide: (choice: string) => void;
  onSnooze: () => void;
  onDismiss: () => void;
  onInstruct: (instruction: string) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const judgment = item.judgment!;
  return (
    <article className="rounded-xl border border-accent/25 bg-accent-soft/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-sm font-semibold text-fg">{item.title}</h3><p className="mt-2 text-xs leading-5 text-fg-muted">{item.detail}</p></div>
        <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[[labels.whyNow, judgment.whyNow], [labels.impact, judgment.impact], [labels.workDone, judgment.workDone], [labels.recommendation, judgment.recommendation]].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-surface-panel/80 p-3"><p className="text-[11px] font-medium text-fg-subtle">{label}</p><p className="mt-1 text-xs leading-5 text-fg">{value}</p></div>
        ))}
      </div>
      {judgment.dispositionReason ? (
        <div className="mt-3 rounded-lg border border-edge-subtle bg-surface-panel/70 p-3 text-xs leading-5">
          <p className="font-medium text-fg-subtle">{labels.policyReason}</p>
          <p className="mt-1 text-fg-muted">{judgment.dispositionReason}</p>
          {judgment.proposedActionTitle ? (
            <p className="mt-2 text-fg">
              <span className="font-medium">{labels.proposedAction}：</span>{judgment.proposedActionTitle}
              {judgment.actionStatus ? ` · ${labels.actionStates[judgment.actionStatus]}` : ''}
            </p>
          ) : null}
          {judgment.actionError ? <p className="mt-1 text-danger">{judgment.actionError}</p> : null}
        </div>
      ) : null}
      {judgment.decision ? <div className="mt-4"><p className="text-sm font-medium text-fg">{judgment.decision.question}</p><div className="mt-2 flex flex-wrap gap-2">{judgment.decision.options.map((option) => (
        <Button key={option.id} type="button" variant="secondary" className="h-auto min-h-9 flex-col items-start px-3 py-2 text-left" disabled={busy} title={option.consequence} onClick={() => onDecide(option.id)}><span>{option.label}</span><span className="text-[10px] font-normal text-fg-muted">{option.consequence}</span></Button>
      ))}</div></div> : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-edge-subtle pt-3">
        <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onSnooze}>{labels.snooze}</Button>
        <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onDismiss}>{labels.dismiss}</Button>
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); const value = instruction.trim(); if (!value) return; onInstruct(value); setInstruction(''); }}>
        <input className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-base px-3 py-2 text-xs text-fg outline-none focus:border-accent" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={labels.feedbackPlaceholder} />
        <Button type="submit" variant="secondary" className="h-9 px-3" disabled={busy || !instruction.trim()}>{labels.applyFeedback}</Button>
      </form>
    </article>
  );
}

export function HomePage() {
  const language = useLocaleStore((state) => state.language);
  const msg = messages(language);
  const t = msg.projectsPage;
  const copy = taskCopy(language);
  const navigate = useNavigate();
  const location = useLocation();
  const backgroundPath = `${location.pathname}${location.search}`;
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [task, setTask] = useState('');
  const [createRequestId, setCreateRequestId] = useState(() => crypto.randomUUID());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null);
  const [busyFocusItemId, setBusyFocusItemId] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<HomeDecision | null>(null);

  const load = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) setLoading(true);
    setLoadError(null);
    try {
      setHome(await fetchHome(language));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const scheduleRefresh = (delayMs: number) => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void load();
      }, delayMs);
    };
    const refreshSoon = () => scheduleRefresh(100);
    const refreshAfterSessionSettles = () => scheduleRefresh(750);
    const immediateEvents = ['session-created', 'agent-run-started', 'agent-run-ended', 'automation-run-completed', 'workflow-run-updated', 'workflow-run-error'];
    const noisySessionEvents = ['session-updated', 'session-transcript-updated'];
    immediateEvents.forEach((name) => window.addEventListener(name, refreshSoon));
    noisySessionEvents.forEach((name) => window.addEventListener(name, refreshAfterSessionSettles));
    return () => {
      immediateEvents.forEach((name) => window.removeEventListener(name, refreshSoon));
      noisySessionEvents.forEach((name) => window.removeEventListener(name, refreshAfterSessionSettles));
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [load]);

  const submitCreate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = task.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const started = await createTask({
        idempotencyKey: createRequestId,
        title: trimmed,
        locale: language,
        priority: 'normal',
        contract: {
          objective: trimmed,
          expectedOutputs: [],
          acceptanceCriteria: [],
          constraints: [],
          approvalRequired: [],
          assumptions: [],
          risks: [],
          acceptancePolicy: 'manual',
          outputDestinations: [],
        },
        dependencies: [],
        context: [],
        authorityGrants: [],
        activation: { mode: 'start' },
      });
      setCreateOpen(false);
      setTask('');
      setCreateRequestId(crypto.randomUUID());
      navigate(taskDetailModalHref(backgroundPath, started.task.id));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }, [backgroundPath, createRequestId, creating, language, navigate, task]);

  const headerEnd = useMemo(() => (
    <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" aria-hidden />
      {copy.newWork}
    </Button>
  ), [copy.newWork]);

  const handleJudgmentAction = useCallback(async (item: HomeDecision, action: () => Promise<unknown>) => {
    setBusyDecisionId(item.id);
    setLoadError(null);
    try { await action(); await load(); }
    catch (err) { setLoadError(err instanceof Error ? err.message : String(err)); }
    finally { setBusyDecisionId(null); }
  }, [load]);

  const runFocusAction = useCallback<HomeActionRunner>((action, itemId) => {
    if (action.type === 'open') {
      navigate(action.href);
      return;
    }
    if (action.type === 'ask_ai') {
      navigate('/chat/new');
      return;
    }
    if (action.type === 'review_judgment') {
      const decision = home?.decisions.find((item) => item.judgment?.inboxItemId === action.itemId);
      if (decision) setReviewDecision(decision);
      return;
    }
    setBusyFocusItemId(itemId);
    setLoadError(null);
    void (async () => {
      try {
        if (action.type === 'connector_decision') {
          await respondToWorkDecision(
            { kind: 'connector_approval', approvalId: action.approvalId },
            action.decision,
          );
        } else if (action.type === 'retry_run') {
          await retryWorkAttention({ kind: action.subjectKind, runId: action.runId });
        } else if (action.type === 'acknowledge_run') {
          await acknowledgeWorkAttention({ kind: action.subjectKind, runId: action.runId });
        }
        await load();
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyFocusItemId(null);
      }
    })();
  }, [home?.decisions, load, navigate]);

  const focusView = useMemo(() => {
    const items = home?.focusItems ?? [];
    const primary = items[0] ?? null;
    const remaining = primary ? items.filter((item) => item.id !== primary.id) : items;
    const select = (kinds: HomeFocusItem['kind'][]) => remaining.filter((item) => kinds.includes(item.kind));
    const primaryKind = primary?.kind;
    return {
      primary,
      needs: {
        items: select(['decision', 'failure']),
        total: Math.max(0, (home?.decisions.length ?? 0) + (home?.attention.length ?? 0) - (primaryKind === 'decision' || primaryKind === 'failure' ? 1 : 0)),
      },
      running: {
        items: select(['running']),
        total: Math.max(0, (home?.tasks.running.length ?? 0) + (home?.workflowRuns.active.length ?? 0) - (primaryKind === 'running' ? 1 : 0)),
      },
      scheduled: {
        items: select(['scheduled']),
        total: Math.max(0, (home?.upcomingAutomations.length ?? 0) - (primaryKind === 'scheduled' ? 1 : 0)),
      },
      results: {
        items: select(['result']),
        total: Math.max(0, (home?.recentTasks.length ?? 0) + (home?.briefing.wins.length ?? 0) - (primaryKind === 'result' ? 1 : 0)),
      },
    };
  }, [home]);

  const primaryKindLabel = focusView.primary
    ? focusView.primary.kind === 'decision'
      ? copy.needsAttention
      : focusView.primary.kind === 'failure'
        ? copy.runAttention
        : focusView.primary.kind === 'running'
          ? t.home.continueTitle
          : focusView.primary.kind === 'result'
            ? t.home.completed
            : focusView.primary.kind === 'scheduled'
              ? t.home.scheduled
              : t.home.primaryFocus
    : t.home.primaryFocus;

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>
          <p className="truncate text-xs text-fg-muted">{t.home.subtitle}</p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, setPageHeader, t.title, t.home.subtitle]);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-7 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <Dialog.Root
        open={createOpen}
        onOpenChange={(open) => {
          if (!creating) setCreateOpen(open);
          if (open) {
            setCreateError(null);
            setCreateRequestId(crypto.randomUUID());
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(31rem,calc(100dvh-1.5rem))] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="flex shrink-0 items-start gap-4 border-b border-edge px-5 py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-fg">
                  {copy.dialogTitle}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-5 text-fg-muted">
                  {copy.dialogDescription}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="-mr-2 -mt-1 size-8 shrink-0 rounded-lg p-0"
                  title={t.cancel}
                  aria-label={t.cancel}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <form onSubmit={submitCreate} className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
                <label htmlFor="new-work-task" className="mb-2 shrink-0 text-sm font-medium text-fg">
                  {copy.intentLabel}
                </label>
                <textarea
                  id="new-work-task"
                  className="min-h-32 w-full flex-1 resize-none rounded-xl border border-edge bg-surface-base p-3 text-sm font-normal leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  value={task}
                  onChange={(event) => {
                    setTask(event.target.value);
                    setCreateRequestId(crypto.randomUUID());
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={copy.intentPlaceholder}
                  maxLength={12_000}
                  autoFocus
                />
                <div className="mt-2 flex shrink-0 items-center justify-between gap-3 text-[11px] text-fg-subtle">
                  <span>{t.home.submitShortcut}</span>
                  <span className="tabular-nums">
                    {task.length.toLocaleString()} / {(12_000).toLocaleString()}
                  </span>
                </div>
                {createError ? <p className="mt-3 text-sm text-danger">{createError}</p> : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild><Button type="button" variant="ghost" disabled={creating}>{t.cancel}</Button></Dialog.Close>
                <Button type="submit" variant="primary" className="min-w-32" disabled={!task.trim() || creating}>
                  <Sparkles className="size-4" aria-hidden />
                  {creating ? copy.starting : copy.submit}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(reviewDecision)} onOpenChange={(open) => { if (!open) setReviewDecision(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(42rem,calc(100dvh-1.5rem))] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3">
              <Dialog.Title className="text-sm font-semibold text-fg">{copy.needsAttention}</Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="size-8 p-0" title={t.cancel} aria-label={t.cancel}>
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {reviewDecision?.judgment ? (
                <AgentJudgmentCard
                  item={reviewDecision}
                  labels={copy}
                  busy={busyDecisionId === reviewDecision.id}
                  onDecide={(choice) => void handleJudgmentAction(reviewDecision, () => decideAgentJudgment(reviewDecision.judgment!.inboxItemId, choice))}
                  onSnooze={() => void handleJudgmentAction(reviewDecision, () => transitionAgentJudgment(reviewDecision.judgment!.inboxItemId, 'snoozed'))}
                  onDismiss={() => void handleJudgmentAction(reviewDecision, () => transitionAgentJudgment(reviewDecision.judgment!.inboxItemId, 'resolved'))}
                  onInstruct={(instruction) => void handleJudgmentAction(reviewDecision, () => instructAgentJudgment(reviewDecision.judgment!.inboxItemId, instruction))}
                />
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{loadError}</span>
          <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => void load()}>{t.home.retry}</Button>
        </div>
      ) : null}

      {loading ? <HomeSkeleton /> : home ? (
        <>
          <section className="border-b border-edge-subtle pb-5">
            <p className="text-xs font-medium text-fg-subtle">{t.home.briefingTitle}</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-fg">
              {home.decisions.length + home.attention.length > 0
                ? interpolate(t.home.todaySummary, {
                    attention: home.decisions.length + home.attention.length,
                    moving: home.briefing.progress.movingCount + home.chats.running.length,
                  })
                : interpolate(t.home.todaySummaryClear, {
                    moving: home.briefing.progress.movingCount + home.chats.running.length,
                  })}
            </h2>
            {home.briefing.summary ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">{home.briefing.summary}</p>
            ) : null}
          </section>

          {focusView.primary ? (
            <FocusHero
              item={focusView.primary}
              kindLabel={primaryKindLabel}
              busy={busyFocusItemId === focusView.primary.id}
              onAction={runFocusAction}
            />
          ) : null}

          <div className="space-y-5">
            <FocusSection title={copy.needsAttention} items={focusView.needs.items} total={focusView.needs.total} viewAllLabel={t.home.viewAll} showLessLabel={t.home.showLess} busyItemId={busyFocusItemId} onAction={runFocusAction} />
            <FocusSection title={t.home.continueTitle} items={focusView.running.items} total={focusView.running.total} viewAllLabel={t.home.viewAll} showLessLabel={t.home.showLess} busyItemId={busyFocusItemId} onAction={runFocusAction} />
            <FocusSection title={t.home.scheduled} items={focusView.scheduled.items} total={focusView.scheduled.total} viewAllHref="/automations" viewAllLabel={t.home.viewAll} showLessLabel={t.home.showLess} busyItemId={busyFocusItemId} onAction={runFocusAction} />
            <FocusSection title={t.home.completed} items={focusView.results.items} total={focusView.results.total} viewAllLabel={t.home.viewAll} showLessLabel={t.home.showLess} busyItemId={busyFocusItemId} onAction={runFocusAction} />

            {home.chats.recent.length > 0 ? (
              <section>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <MessageCircle className="size-4 text-fg-muted" aria-hidden />
                  <h2 className="text-sm font-semibold text-fg">{copy.recent}</h2>
                </div>
                <div className="divide-y divide-edge-subtle overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base shadow-surface">
                  {home.chats.recent.slice(0, 3).map((chat) => (
                    <Link key={chat.key} to={`/chat/${encodeURIComponent(chat.key)}`} className="flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-surface-hover/55 sm:px-4">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted"><MessageCircle className="size-4" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{chat.name}</span>
                        <span className="mt-0.5 block text-xs text-fg-subtle">{formatTime(chat.updatedAt, '')}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

        </>
      ) : null}

    </main>
  );
}
