import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  Clock3,
  Eye,
  FolderKanban,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkbenchActivity } from '@/features/activity/workbench-activity';
import {
  configureFocusMonitor,
  deleteFocus,
  fetchFocusCandidates,
  fetchFocuses,
  respondToFocusCandidate,
  updateFocus,
} from '@/features/focuses/api';
import { focusCopy } from '@/features/focuses/copy';
import { FocusCard } from '@/features/focuses/focus-card';
import type { Focus, FocusCandidate, FocusMonitorKind, FocusStatus } from '@/features/focuses/types';
import { fetchProjects, type Project } from '@/features/projects/api';
import {
  acknowledgeWorkAttention,
  fetchWorkHome,
  respondToWorkDecision,
  retryWorkAttention,
  type WorkHomeAttention,
  type WorkHomeChat,
  type WorkHomeDecision,
  type WorkHomeItem,
  type WorkHomeResponse,
} from '@/features/work/work-home-api';
import { workCopy } from '@/features/work/work-copy';
import { workflowBoardHref } from '@/features/workflows/workflow-page.utils';
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

function WorkBadge({ children }: { children: string }) {
  return <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">{children}</span>;
}

function WorkHomeSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-20 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
  );
}

function WorkItemCard({
  item,
  statusLabel,
}: {
  item: WorkHomeItem;
  statusLabel: string;
}) {
  return (
    <Link
      to={`/work-items/${encodeURIComponent(item.id)}`}
      className="group block rounded-lg px-1 py-2.5 transition-colors hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{item.title}</h3>
          <p className="mt-1 truncate text-xs text-fg-subtle">{item.projectName}</p>
        </div>
        <span className="shrink-0 text-xs text-fg-subtle">
          {statusLabel}
        </span>
      </div>
      {item.blockedReason || item.nextAction ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-muted">
          {item.blockedReason || item.nextAction}
        </p>
      ) : null}
    </Link>
  );
}

function WorkChatCard({ chat, statusLabel }: { chat: WorkHomeChat; statusLabel: string }) {
  return (
    <Link
      to={`/chat/${encodeURIComponent(chat.key)}`}
      className="group block rounded-xl border border-edge-subtle bg-surface-panel p-4 transition-colors hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{chat.name}</h3>
        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">{statusLabel}</span>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">{formatTime(chat.updatedAt, '')}</p>
    </Link>
  );
}

function DecisionCard({
  item,
  kindLabel,
  reasonLabel,
  approveLabel,
  denyLabel,
  busy,
  onRespond,
}: {
  item: WorkHomeDecision;
  kindLabel: string;
  reasonLabel: string;
  approveLabel: string;
  denyLabel: string;
  busy: boolean;
  onRespond: (decision: 'approve' | 'deny') => void;
}) {
  return (
    <article className="rounded-xl border border-warning/35 bg-warning-soft/25 p-3.5 transition-colors hover:bg-warning-soft/40">
      <Link to={item.href} className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{item.title}</h3>
          <p className="mt-1 truncate text-xs text-fg-subtle">{item.projectName || kindLabel}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-panel/80 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
          {reasonLabel}
        </span>
      </div>
      {item.detail ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-muted">{item.detail}</p> : null}
      </Link>
      {item.response ? (
        <div className="mt-3 flex justify-end gap-2 border-t border-warning/20 pt-3">
          <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => onRespond('deny')}>{denyLabel}</Button>
          <Button type="button" variant="primary" className="h-8 px-2" disabled={busy} onClick={() => onRespond('approve')}>{approveLabel}</Button>
        </div>
      ) : null}
    </article>
  );
}

function AttentionCard({
  item,
  statusLabel,
  retryLabel,
  viewLabel,
  acknowledgeLabel,
  busy,
  onView,
  onRetry,
  onAcknowledge,
}: {
  item: WorkHomeAttention;
  statusLabel: string;
  retryLabel: string;
  viewLabel: string;
  acknowledgeLabel: string;
  busy: boolean;
  onView: () => void;
  onRetry: () => void;
  onAcknowledge: () => void;
}) {
  return (
    <article className="rounded-xl border border-danger/25 bg-danger-soft/35 p-3.5">
      <Link to={item.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{item.title}</h3>
          <span className="shrink-0 rounded-full bg-surface-panel/80 px-2 py-0.5 text-[11px] font-medium text-danger">
            {statusLabel}
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-fg-muted">{item.detail}</p>
      </Link>
      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-danger/15 pt-3">
        <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onAcknowledge}>{acknowledgeLabel}</Button>
        <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onView}>{viewLabel}</Button>
        <Button type="button" variant="primary" className="h-8 px-2" disabled={busy} onClick={onRetry}>{retryLabel}</Button>
      </div>
    </article>
  );
}

function ProjectCard({ project, openLabel, noDescription }: {
  project: Project;
  openLabel: string;
  noDescription: string;
}) {
  return (
    <Link
      to={`/projects/${encodeURIComponent(project.id)}`}
      className="group flex min-h-32 flex-col rounded-xl border border-edge-subtle bg-surface-panel p-4 transition-colors hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderKanban className="size-4 shrink-0 text-accent" aria-hidden />
          <h3 className="truncate text-sm font-semibold text-fg">{project.name}</h3>
        </div>
        <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-label={openLabel} />
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-fg-muted">
        {project.description || project.brief || noDescription}
      </p>
      <p className="mt-auto pt-3 text-[11px] text-fg-subtle">
        {formatTime(project.lastActiveAt ?? project.updatedAt, '')}
      </p>
    </Link>
  );
}

export function WorkPage() {
  const language = useLocaleStore((state) => state.language);
  const msg = messages(language);
  const t = msg.projectsPage;
  const focusText = focusCopy(language);
  const workText = workCopy(language);
  const navigate = useNavigate();
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [home, setHome] = useState<WorkHomeResponse | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [focuses, setFocuses] = useState<Focus[]>([]);
  const [focusCandidates, setFocusCandidates] = useState<FocusCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null);
  const [busyAttentionId, setBusyAttentionId] = useState<string | null>(null);
  const [busyFocusId, setBusyFocusId] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);

  const load = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) setLoading(true);
    setLoadError(null);
    try {
      const [homeResult, projectsResult, focusResult, candidateResult] = await Promise.all([
        fetchWorkHome(language),
        fetchProjects({ limit: 100, sortBy: 'updatedAt', sortOrder: 'desc' }),
        fetchFocuses(),
        fetchFocusCandidates(),
      ]);
      setHome(homeResult);
      setProjects(projectsResult.items);
      setFocuses(focusResult);
      setFocusCandidates(candidateResult);
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
    const immediateEvents = ['session-created', 'agent-run-started', 'agent-run-ended', 'automation-run-completed', 'workflow-run-updated', 'workflow-run-error', 'focus-created', 'focus-updated', 'focus-deleted', 'focus-monitor-updated', 'focus-run-updated', 'focus-insight-updated', 'focus-candidate-updated'];
    const noisySessionEvents = ['session-updated', 'session-transcript-updated'];
    immediateEvents.forEach((name) => window.addEventListener(name, refreshSoon));
    noisySessionEvents.forEach((name) => window.addEventListener(name, refreshAfterSessionSettles));
    return () => {
      immediateEvents.forEach((name) => window.removeEventListener(name, refreshSoon));
      noisySessionEvents.forEach((name) => window.removeEventListener(name, refreshAfterSessionSettles));
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [load]);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const active = projects.filter((project) => project.status !== 'archived');
    if (!query) return active.slice(0, 6);
    return active.filter((project) => [project.name, project.description, project.brief]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(query)));
  }, [projects, search]);

  const needsYou = useMemo(() => home?.decisions ?? [], [home]);
  const attention = useMemo(() => home?.attention ?? [], [home]);
  const continuing = useMemo(() => home?.work.current.filter((item) => (
    item.status !== 'needs_input'
    && item.status !== 'in_review'
    && item.status !== 'blocked'
  )).slice(0, 10) ?? [], [home]);

  const submitCreate = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = outcome.trim();
    if (!trimmed) return;
    setOutcome('');
    setCreateOpen(false);
    const query = new URLSearchParams({ draft: trimmed, autoSend: '1' });
    navigate({ pathname: '/chat/new', search: `?${query.toString()}` }, { state: { forceNewChat: true } });
  }, [navigate, outcome]);

  const headerEnd = useMemo(() => (
    <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" aria-hidden />
      {workText.newWork}
    </Button>
  ), [workText.newWork]);

  const respondToDecision = useCallback(async (item: WorkHomeDecision, decision: 'approve' | 'deny') => {
    if (!item.response) return;
    setBusyDecisionId(item.id);
    setLoadError(null);
    try {
      await respondToWorkDecision(item.response, decision);
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDecisionId(null);
    }
  }, [load]);

  const performAttentionAction = useCallback(async (
    item: WorkHomeAttention,
    action: (target: Pick<WorkHomeAttention, 'kind' | 'runId'>) => Promise<unknown>,
  ) => {
    setBusyAttentionId(item.id);
    setLoadError(null);
    try {
      await action({ kind: item.kind, runId: item.runId });
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAttentionId(null);
    }
  }, [load]);

  const performFocusAction = useCallback(async (focusId: string, action: () => Promise<void>, notice = focusText.operationDone) => {
    setBusyFocusId(focusId);
    setLoadError(null);
    setFocusNotice(null);
    try {
      await action();
      const [nextFocuses, nextCandidates] = await Promise.all([fetchFocuses(), fetchFocusCandidates()]);
      setFocuses(nextFocuses);
      setFocusCandidates(nextCandidates);
      setFocusNotice(notice);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyFocusId(null);
    }
  }, [focusText.operationDone]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>
          <p className="truncate text-xs text-fg-muted">{t.workHome.subtitle}</p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, setPageHeader, t.title, t.workHome.subtitle]);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-7 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <Dialog.Root
        open={createOpen}
        onOpenChange={setCreateOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(31rem,calc(100dvh-1.5rem))] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="flex shrink-0 items-start gap-4 border-b border-edge px-5 py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-fg">
                  {workText.dialogTitle}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-5 text-fg-muted">
                  {workText.dialogDescription}
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
                <label htmlFor="new-work-outcome" className="mb-2 shrink-0 text-sm font-medium text-fg">
                  {workText.intentLabel}
                </label>
                <textarea
                  id="new-work-outcome"
                  className="min-h-32 w-full flex-1 resize-none rounded-xl border border-edge bg-surface-base p-3 text-sm font-normal leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={workText.intentPlaceholder}
                  maxLength={12_000}
                  autoFocus
                />
                <div className="mt-2 flex shrink-0 items-center justify-between gap-3 text-[11px] text-fg-subtle">
                  <span>{t.workHome.submitShortcut}</span>
                  <span className="tabular-nums">
                    {outcome.length.toLocaleString()} / {(12_000).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild><Button type="button" variant="ghost">{t.cancel}</Button></Dialog.Close>
                <Button type="submit" variant="primary" className="min-w-32" disabled={!outcome.trim()}>
                  <Sparkles className="size-4" aria-hidden />
                  {workText.submit}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{loadError}</span>
          <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => void load()}>{t.workHome.retry}</Button>
        </div>
      ) : null}

      {loading ? <WorkHomeSkeleton /> : home ? (
        <>
          <section className="border-b border-edge-subtle pb-5">
            <p className="text-xs font-medium text-fg-subtle">{t.workHome.briefingTitle}</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-fg">
              {home.decisions.length + home.attention.length > 0
                ? interpolate(t.workHome.todaySummary, {
                    attention: home.decisions.length + home.attention.length,
                    moving: home.briefing.progress.movingCount + home.chats.running.length,
                  })
                : interpolate(t.workHome.todaySummaryClear, {
                    moving: home.briefing.progress.movingCount + home.chats.running.length,
                  })}
            </h2>
            {home.briefing.summary ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">{home.briefing.summary}</p>
            ) : null}
          </section>

          {focusNotice ? <div role="status" className="rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm text-success">{focusNotice}</div> : null}

          {home.work.current.length === 0
            && home.workflowRuns.active.length === 0
            && home.decisions.length === 0
            && home.attention.length === 0
            && home.chats.running.length === 0
            && home.chats.recent.length === 0
            && home.upcomingAutomations.length === 0
            && focuses.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-edge p-8 text-center">
              <MessageCircle className="mx-auto size-6 text-accent" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-fg">{t.workHome.emptyTitle}</h2>
              <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-fg-muted">{t.workHome.emptyBody}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button type="button" variant="primary" onClick={() => navigate('/chat/new')}>{t.workHome.startChat}</Button>
                <Button type="button" variant="secondary" onClick={() => setCreateOpen(true)}>{workText.newWork}</Button>
              </div>
            </section>
          ) : null}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <div className="min-w-0 space-y-6">
              {attention.length > 0 ? (
                <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
                  <div className="flex items-center gap-2">
                    <CircleAlert className="size-4 text-danger" aria-hidden />
                    <h2 className="text-base font-semibold text-fg">{workText.runAttention}</h2>
                    <WorkBadge>{attention.length.toLocaleString()}</WorkBadge>
                  </div>
                  <div className="mt-4 space-y-2">
                    {attention.map((item) => (
                      <AttentionCard
                        key={item.id}
                        item={item}
                        statusLabel={item.reason === 'run_timeout' ? t.workHome.attentionTimeout : t.workHome.attentionFailed}
                        retryLabel={t.workHome.attentionRetry}
                        viewLabel={t.workHome.attentionView}
                        acknowledgeLabel={t.workHome.attentionAcknowledge}
                        busy={busyAttentionId === item.id}
                        onView={() => navigate(item.href)}
                        onRetry={() => void performAttentionAction(item, retryWorkAttention)}
                        onAcknowledge={() => void performAttentionAction(item, acknowledgeWorkAttention)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {needsYou.length > 0 ? (
                <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
                  <div className="flex items-center gap-2"><CircleAlert className="size-4 text-warning" aria-hidden /><h2 className="text-base font-semibold text-fg">{workText.needsAttention}</h2><WorkBadge>{needsYou.length.toLocaleString()}</WorkBadge></div>
                  <div className="mt-4 space-y-2">
                    {needsYou.map((item) => (
                      <DecisionCard
                        key={item.id}
                        item={item}
                        kindLabel={t.workHome.decisionKinds[item.kind]}
                        reasonLabel={t.workHome.decisionReasons[item.reason]}
                        approveLabel={t.workHome.approve}
                        denyLabel={t.workHome.deny}
                        busy={busyDecisionId === item.id}
                        onRespond={(decision) => void respondToDecision(item, decision)}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <p className="flex items-center gap-2 text-sm text-fg-muted">
                  <span className="flex size-5 items-center justify-center rounded-full bg-success-soft text-xs text-success" aria-hidden>✓</span>
                  {t.workHome.nothingNeedsYou}
                </p>
              )}

              <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
                <div className="flex items-center gap-2"><Sparkles className="size-4 text-accent" aria-hidden /><h2 className="text-base font-semibold text-fg">{workText.running}</h2><WorkBadge>{(home.chats.running.length + home.workflowRuns.active.length).toLocaleString()}</WorkBadge></div>
                <div className="mt-4 divide-y divide-edge-subtle px-1">
                  {home.chats.running.map((chat) => <div key={chat.key} className="py-1"><WorkChatCard chat={chat} statusLabel={t.workHome.running} /></div>)}
                  {home.workflowRuns.active.map((run) => (
                    <Link key={run.id} to={workflowBoardHref(run.id)} className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 text-sm hover:bg-surface-hover/55">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                        <span className="truncate font-medium text-fg">{run.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-fg-subtle">{t.workHome.running}</span>
                    </Link>
                  ))}
                  {home.chats.running.length === 0 && home.workflowRuns.active.length === 0 ? (
                    <p className="py-6 text-center text-sm text-fg-muted">{workText.emptyRunning}</p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
                <div className="flex items-center gap-2"><Clock3 className="size-4 text-fg-subtle" aria-hidden /><h2 className="text-base font-semibold text-fg">{workText.continue}</h2><WorkBadge>{continuing.length.toLocaleString()}</WorkBadge></div>
                <div className="mt-4 divide-y divide-edge-subtle px-1">
                  {continuing.map((item) => <div key={item.id} className="py-1"><WorkItemCard item={item} statusLabel={msg.projectDetailPage.workItems.statuses[item.status]} /></div>)}
                  {continuing.length === 0 ? <p className="py-6 text-center text-sm text-fg-muted">{workText.emptyContinue}</p> : null}
                </div>
              </section>

              {home.chats.recent.length > 0 ? <section className="rounded-2xl bg-surface-base p-5 shadow-surface"><div className="flex items-center gap-2"><h2 className="text-base font-semibold text-fg">{workText.recent}</h2></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{home.chats.recent.slice(0, 6).map((chat) => <WorkChatCard key={chat.key} chat={chat} statusLabel={workText.openChat} />)}</div></section> : null}
            </div>

            <aside className="min-w-0 space-y-4" aria-label={t.workHome.nowTitle}>
              <div className="px-1">
                <h2 className="text-base font-semibold text-fg">{t.workHome.nowTitle}</h2>
              </div>
              {home.upcomingAutomations.length > 0 ? (
                <section className="rounded-2xl bg-surface-base p-4 shadow-surface">
                  <div className="flex items-center gap-2"><CalendarClock className="size-4 text-fg-subtle" aria-hidden /><h3 className="text-sm font-semibold text-fg">{t.workHome.scheduled}</h3></div>
                  <div className="mt-2 divide-y divide-edge-subtle">{home.upcomingAutomations.slice(0, 3).map((automation) => (
                    <Link key={automation.id} to="/automations" className="flex items-center justify-between gap-3 rounded-lg px-1 py-3 text-sm hover:bg-surface-hover/55">
                      <span className="min-w-0 truncate text-fg">{automation.name || automation.action}</span>
                      <time className="shrink-0 text-xs text-fg-subtle">{formatTime(automation.nextRunAt, t.never)}</time>
                    </Link>
                  ))}</div>
                </section>
              ) : null}
              <WorkbenchActivity />
              {home.briefing.wins.length > 0 ? (
                <Link
                  to={home.briefing.wins[0].href}
                  className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm text-fg-muted hover:bg-surface-hover/55 hover:text-fg"
                >
                  <span>{interpolate(t.workHome.completedSummary, { count: home.briefing.wins.length })}</span>
                  <span className="shrink-0 text-xs font-medium text-accent">{t.workHome.viewLatestResult} →</span>
                </Link>
              ) : null}
            </aside>
          </div>

          <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
            <div className="flex flex-wrap items-center gap-2"><Eye className="size-4 text-accent" aria-hidden /><h2 className="text-base font-semibold text-fg">{workText.focuses}</h2><WorkBadge>{focuses.length.toLocaleString()}</WorkBadge></div>
            {focuses.length > 0 ? <div className="mt-4 grid gap-3 md:grid-cols-2">{focuses.slice(0, 6).map((focus) => <FocusCard key={focus.id} focus={focus} language={language} busy={busyFocusId === focus.id} onMonitor={(kind: FocusMonitorKind, enabled: boolean) => void performFocusAction(focus.id, async () => { await configureFocusMonitor(focus.id, kind, enabled); }, enabled ? focusText.monitorStarted : focusText.monitorStopped)} onStatus={(status: FocusStatus) => void performFocusAction(focus.id, async () => { await updateFocus(focus.id, { status }); })} onDelete={() => { if (window.confirm(focusText.deleteConfirm)) void performFocusAction(focus.id, () => deleteFocus(focus.id)); }} />)}</div> : <div className="py-8 text-center"><p className="text-sm font-medium text-fg">{focusText.empty}</p><p className="mt-1 text-xs text-fg-muted">{focusText.emptyHint}</p></div>}
          </section>

          {focusCandidates.length > 0 ? <section className="rounded-2xl border border-dashed border-edge p-5"><h2 className="text-base font-semibold text-fg">{focusText.candidates}</h2><p className="mt-1 text-xs text-fg-muted">{focusText.candidatesHint}</p><div className="mt-4 space-y-2">{focusCandidates.map((candidate) => <article key={candidate.id} className="flex flex-col gap-3 rounded-xl bg-surface-panel p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="text-sm font-semibold text-fg">{candidate.title}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{candidate.summary}</p></div><div className="flex shrink-0 gap-2"><Button variant="ghost" className="h-8 text-xs" disabled={busyFocusId === candidate.id} onClick={() => void performFocusAction(candidate.id, async () => { await respondToFocusCandidate(candidate.id, 'dismiss'); })}>{focusText.dismiss}</Button><Button variant="primary" className="h-8 text-xs" disabled={busyFocusId === candidate.id} onClick={() => void performFocusAction(candidate.id, async () => { await respondToFocusCandidate(candidate.id, 'accept'); })}>{focusText.accept}</Button></div></article>)}</div></section> : null}
        </>
      ) : null}

      <section className="border-t border-edge-subtle pt-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">{workText.projects}</h2>
          <Link to="/projects" className="text-xs font-medium text-accent hover:underline">{t.management.viewAll}</Link>
        </div>
        {projects.filter((project) => project.status !== 'archived').length > 6 ? <div className="mt-3 flex justify-end">
          <label className="relative block min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input className="h-9 w-52 rounded-lg border border-edge bg-surface-panel pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} />
          </label>
        </div> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} openLabel={t.workHome.openSpace} noDescription={t.noDescription} />)}
        </div>
        {!loading && visibleProjects.length === 0 ? <p className="py-8 text-center text-sm text-fg-muted">{t.workHome.noSpaces}</p> : null}
      </section>
    </main>
  );
}
