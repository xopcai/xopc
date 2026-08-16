import * as Dialog from '@radix-ui/react-dialog';
import type { Outcome, OutcomeReceipt } from '@xopcai/gateway-contract';
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  MessageCircle,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkbenchActivity } from '@/features/activity/workbench-activity';
import {
  acknowledgeWorkAttention,
  confirmWorkIntake,
  decideAgentJudgment,
  fetchWorkHome,
  instructAgentJudgment,
  proposeWorkIntake,
  respondToWorkDecision,
  retryWorkAttention,
  transitionAgentJudgment,
  type WorkHomeAttention,
  type WorkHomeChat,
  type WorkHomeDecision,
  type WorkHomeResponse,
  type WorkIntakeProposal,
} from '@/features/work/work-home-api';
import { workCopy } from '@/features/work/work-copy';
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

function OutcomeCard({ outcome, statusLabel }: { outcome: Outcome; statusLabel: string }) {
  return (
    <Link
      to={`/work/${encodeURIComponent(outcome.id)}`}
      className="group flex items-start justify-between gap-3 rounded-xl border border-edge-subtle bg-surface-panel p-4 transition-colors hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="min-w-0">
        <h3 className="line-clamp-2 text-sm font-semibold text-fg">{outcome.objective}</h3>
        <p className="mt-2 text-xs text-fg-subtle">{formatTime(outcome.updatedAt, '')}</p>
      </div>
      <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">
        {statusLabel}
      </span>
    </Link>
  );
}

function OutcomeReceiptCard({ receipt, evidenceLabel, remainingLabel }: {
  receipt: OutcomeReceipt;
  evidenceLabel: string;
  remainingLabel: string;
}) {
  const href = receipt.outcomeId
    ? `/work/${encodeURIComponent(receipt.outcomeId)}`
    : receipt.projectId
      ? `/projects/${encodeURIComponent(receipt.projectId)}`
    : `/chat/${encodeURIComponent(receipt.sessionKey)}`;
  return (
    <Link to={href} className="block rounded-xl border border-edge-subtle px-3 py-3 hover:bg-surface-hover/55">
      <div className="flex items-start gap-2">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{receipt.objective}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{receipt.summary}</p>
          <p className="mt-2 text-[11px] text-fg-subtle">
            {receipt.evidence.length} {evidenceLabel}
            {receipt.remainingWork.length > 0 ? ` · ${receipt.remainingWork.length} ${remainingLabel}` : ''}
          </p>
        </div>
      </div>
    </Link>
  );
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

function AgentJudgmentCard({
  item,
  labels,
  busy,
  onDecide,
  onSnooze,
  onDismiss,
  onInstruct,
}: {
  item: WorkHomeDecision;
  labels: ReturnType<typeof workCopy>;
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

export function WorkPage() {
  const language = useLocaleStore((state) => state.language);
  const msg = messages(language);
  const t = msg.projectsPage;
  const workText = workCopy(language);
  const navigate = useNavigate();
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [home, setHome] = useState<WorkHomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [proposal, setProposal] = useState<WorkIntakeProposal | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null);
  const [busyAttentionId, setBusyAttentionId] = useState<string | null>(null);

  const load = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) setLoading(true);
    setLoadError(null);
    try {
      setHome(await fetchWorkHome(language));
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

  const needsYou = useMemo(() => home?.decisions ?? [], [home]);
  const attention = useMemo(() => home?.attention ?? [], [home]);

  const submitCreate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = outcome.trim();
    if (!trimmed) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      setProposal(await proposeWorkIntake(trimmed));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateBusy(false);
    }
  }, [outcome]);

  const confirmCreate = useCallback(async () => {
    if (!proposal) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const work = await confirmWorkIntake(proposal.id);
      setCreateOpen(false);
      setOutcome('');
      setProposal(null);
      await load();
      navigate(`/work/${encodeURIComponent(work.outcomeId)}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateBusy(false);
    }
  }, [load, navigate, proposal]);

  const resetCreate = useCallback(() => {
    setProposal(null);
    setCreateError(null);
  }, []);

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

  const handleJudgmentAction = useCallback(async (item: WorkHomeDecision, action: () => Promise<unknown>) => {
    setBusyDecisionId(item.id);
    setLoadError(null);
    try { await action(); await load(); }
    catch (err) { setLoadError(err instanceof Error ? err.message : String(err)); }
    finally { setBusyDecisionId(null); }
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
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreate();
        }}
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
            {!proposal ? <form onSubmit={(event) => void submitCreate(event)} className="flex min-h-0 flex-1 flex-col">
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
                <Button type="submit" variant="primary" className="min-w-32" disabled={!outcome.trim() || createBusy}>
                  <Sparkles className="size-4" aria-hidden />
                  {workText.submit}
                </Button>
              </div>
            </form> : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <h3 className="text-sm font-semibold text-fg">{workText.proposalTitle}</h3>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="rounded-xl border border-edge-subtle bg-surface-base p-3">
                      <dt className="text-xs font-medium text-fg-subtle">{workText.outcomeLabel}</dt>
                      <dd className="mt-1 leading-6 text-fg">{proposal.objective}</dd>
                    </div>
                    <div className="rounded-xl border border-edge-subtle bg-surface-base p-3">
                      <dt className="text-xs font-medium text-fg-subtle">{workText.nextActionLabel}</dt>
                      <dd className="mt-1 space-y-1 leading-6 text-fg">
                        {proposal.outcomeContract.deliverables.map((item) => <p key={item}>· {item}</p>)}
                      </dd>
                    </div>
                    {proposal.outcomeContract.acceptanceCriteria.length > 0 ? (
                      <div className="rounded-xl border border-edge-subtle bg-surface-base p-3">
                        <dt className="text-xs font-medium text-fg-subtle">{workText.confirmWork}</dt>
                        <dd className="mt-1 space-y-1 leading-6 text-fg">
                          {proposal.outcomeContract.acceptanceCriteria.map((item) => <p key={item}>· {item}</p>)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
                <div className="flex shrink-0 justify-between gap-2 border-t border-edge px-5 py-4">
                  <Button type="button" variant="ghost" disabled={createBusy} onClick={resetCreate}>{workText.editIntent}</Button>
                  <Button type="button" variant="primary" className="min-w-36" disabled={createBusy} onClick={() => void confirmCreate()}>
                    <CircleCheck className="size-4" aria-hidden />
                    {workText.confirmWork}
                  </Button>
                </div>
              </div>
            )}
            {createError ? <p className="shrink-0 border-t border-danger/20 bg-danger-soft px-5 py-2 text-xs text-danger">{createError}</p> : null}
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

          {home.outcomes.running.length === 0
            && home.outcomes.needsUser.length === 0
            && home.workflowRuns.active.length === 0
            && home.decisions.length === 0
            && home.attention.length === 0
            && home.chats.running.length === 0
            && home.chats.recent.length === 0
            && home.upcomingAutomations.length === 0 ? (
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
                    {needsYou.map((item) => item.kind === 'agent_judgment' && item.judgment ? (
                      <AgentJudgmentCard
                        key={item.id}
                        item={item}
                        labels={workText}
                        busy={busyDecisionId === item.id}
                        onDecide={(choice) => void handleJudgmentAction(item, () => decideAgentJudgment(item.judgment!.inboxItemId, choice))}
                        onSnooze={() => void handleJudgmentAction(item, () => transitionAgentJudgment(item.judgment!.inboxItemId, 'snoozed'))}
                        onDismiss={() => void handleJudgmentAction(item, () => transitionAgentJudgment(item.judgment!.inboxItemId, 'resolved'))}
                        onInstruct={(instruction) => void handleJudgmentAction(item, () => instructAgentJudgment(item.judgment!.inboxItemId, instruction))}
                      />
                    ) : (
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

              {home.outcomes.needsUser.length > 0 ? (
                <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
                  <div className="flex items-center gap-2"><CircleAlert className="size-4 text-warning" aria-hidden /><h2 className="text-base font-semibold text-fg">{workText.needsAttention}</h2><WorkBadge>{home.outcomes.needsUser.length.toLocaleString()}</WorkBadge></div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {home.outcomes.needsUser.map((item) => <OutcomeCard key={item.id} outcome={item} statusLabel={workText.outcomeStatuses.needs_user} />)}
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
                <div className="flex items-center gap-2"><Sparkles className="size-4 text-accent" aria-hidden /><h2 className="text-base font-semibold text-fg">{workText.running}</h2><WorkBadge>{home.outcomes.running.length.toLocaleString()}</WorkBadge></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {home.outcomes.running.map((item) => <OutcomeCard key={item.id} outcome={item} statusLabel={workText.outcomeStatuses.running} />)}
                  {home.outcomes.running.length === 0 ? (
                    <p className="py-6 text-center text-sm text-fg-muted">{workText.emptyRunning}</p>
                  ) : null}
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
              {home.recentOutcomes.length > 0 ? (
                <section className="rounded-2xl bg-surface-base p-4 shadow-surface">
                  <div className="flex items-center gap-2">
                    <CircleCheck className="size-4 text-success" aria-hidden />
                    <h3 className="text-sm font-semibold text-fg">{workText.recentOutcomes}</h3>
                  </div>
                  <div className="mt-3 space-y-2">
                    {home.recentOutcomes.slice(0, 3).map((receipt) => (
                      <OutcomeReceiptCard
                        key={receipt.runId}
                        receipt={receipt}
                        evidenceLabel={workText.evidenceCount}
                        remainingLabel={workText.remainingCount}
                      />
                    ))}
                  </div>
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

        </>
      ) : null}

    </main>
  );
}
