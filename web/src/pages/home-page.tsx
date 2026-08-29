import * as Dialog from '@radix-ui/react-dialog';
import type { HomeAction, HomeWorkbenchItem } from '@xopcai/gateway-contract';
import { CalendarClock, ChevronRight, CircleAlert, Plus, Sparkles, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { newChatAutoSendHref } from '@/features/chat/session/composer-handoff-params';
import {
  acknowledgeWorkAttention,
  decideAgentJudgment,
  fetchHome,
  instructAgentJudgment,
  respondToWorkDecision,
  retryWorkAttention,
  transitionAgentJudgment,
  type HomeDecision,
  type HomeResponse,
} from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';
import { messages } from '@/i18n/messages';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
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
  recommendationLabel,
  dueLabel,
  failureLabel,
  locale,
  onAction,
}: {
  item: HomeWorkbenchItem;
  busy: boolean;
  recommendationLabel: string;
  dueLabel: string;
  failureLabel: string;
  locale: 'en' | 'zh';
  onAction: HomeActionRunner;
}) {
  const due = item.dueAt ? `${dueLabel} ${formatMediumDateTime(new Date(item.dueAt), locale)}` : null;
  const kicker = item.kind === 'failure' ? failureLabel : due;
  return (
    <article className="px-5 py-5 sm:px-6 sm:py-6">
      {kicker ? (
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-warning">
          <span className="size-1.5 rounded-full bg-warning" aria-hidden />
          <span>{kicker}</span>
        </div>
      ) : null}
      <button
        type="button"
        className="block w-full text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-accent"
        disabled={!item.openAction}
        onClick={() => item.openAction && onAction(item.openAction, item.id)}
      >
        <span className="block text-lg font-semibold leading-7 tracking-tight text-fg">{item.title}</span>
        <span className="mt-1.5 block text-sm leading-6 text-fg-muted">{item.summary}</span>
      </button>
      {item.recommendation ? (
        <p className="mt-3 text-sm leading-6 text-fg-muted">
          <span className="font-semibold text-fg">{recommendationLabel}：</span>
          {item.recommendation}
        </p>
      ) : null}
      {item.primaryAction || item.secondaryActions.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {item.primaryAction ? (
            <Button
              type="button"
              variant="primary"
              className="h-9 rounded-lg px-3.5 text-xs"
              disabled={busy}
              onClick={() => onAction(item.primaryAction!, item.id)}
            >
              {item.primaryAction.label}
            </Button>
          ) : null}
          {item.secondaryActions.map((action) => (
            <Button
              key={`${action.type}:${action.label}`}
              type="button"
              variant="secondary"
              className="h-9 rounded-lg px-3.5 text-xs shadow-none"
              disabled={busy}
              onClick={() => onAction(action, item.id)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function BackgroundRow({ item, onAction }: { item: HomeWorkbenchItem; onAction: HomeActionRunner }) {
  const icon = item.kind === 'scheduled'
    ? <CalendarClock className="size-4" aria-hidden />
    : <span className="size-1.5 rounded-full bg-success" aria-hidden />;
  return (
    <button
      type="button"
      className="flex min-h-16 w-full items-center gap-3 py-3 text-left outline-none hover:text-fg focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-accent"
      disabled={!item.openAction}
      onClick={() => item.openAction && onAction(item.openAction, item.id)}
    >
      <span className="flex size-7 shrink-0 items-center justify-center text-fg-subtle">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">{item.summary}</span>
      </span>
      {item.statusLabel ? <span className="shrink-0 text-xs text-fg-subtle">{item.statusLabel}</span> : null}
      {item.openAction ? <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden /> : null}
    </button>
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
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<HomeDecision | null>(null);

  const load = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) setLoading(true);
    setLoadError(null);
    try {
      setHome(await fetchHome(language));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
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

  const startConversation = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const href = newChatAutoSendHref(intent);
    if (!href) return;
    setConversationOpen(false);
    setIntent('');
    navigate(href);
  }, [intent, navigate]);

  const isIdle = Boolean(home && home.needsUser.length === 0 && home.backgroundCount === 0);
  const headerEnd = useMemo(() => isIdle ? null : (
    <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => setConversationOpen(true)}>
      <Plus className="size-4" aria-hidden />
      {copy.newWork}
    </Button>
  ), [copy.newWork, isIdle]);

  const handleJudgmentAction = useCallback(async (item: HomeDecision, action: () => Promise<unknown>) => {
    setBusyDecisionId(item.id);
    setLoadError(null);
    try {
      await action();
      await load();
      setReviewDecision(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyDecisionId(null);
    }
  }, [load]);

  const runAction = useCallback<HomeActionRunner>((action, itemId) => {
    if (action.type === 'open') {
      navigate(action.href);
      return;
    }
    if (action.type === 'review_judgment') {
      const decision = home?.decisions.find((item) => item.judgment?.inboxItemId === action.itemId);
      if (decision) setReviewDecision(decision);
      return;
    }
    setBusyItemId(itemId);
    setLoadError(null);
    void (async () => {
      try {
        if (action.type === 'connector_decision') {
          await respondToWorkDecision({ kind: 'connector_approval', approvalId: action.approvalId }, action.decision);
        } else if (action.type === 'retry_run') {
          await retryWorkAttention({ kind: action.subjectKind, runId: action.runId });
        } else if (action.type === 'acknowledge_run') {
          await acknowledgeWorkAttention({ kind: action.subjectKind, runId: action.runId });
        }
        await load();
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyItemId(null);
      }
    })();
  }, [home?.decisions, load, navigate]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>,
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, setPageHeader, t.title]);

  const needsUserCount = home?.needsUser.length ?? 0;
  const backgroundCount = home?.backgroundCount ?? 0;
  const headline = needsUserCount > 0
    ? interpolate(t.home.attentionTitle, { count: needsUserCount })
    : backgroundCount > 0
      ? t.home.clearTitle
      : t.home.idleTitle;
  const intro = needsUserCount > 0
    ? backgroundCount > 0
      ? interpolate(t.home.attentionIntroWithBackground, { count: backgroundCount })
      : t.home.attentionIntro
    : backgroundCount > 0
      ? interpolate(t.home.clearIntro, { count: backgroundCount })
      : t.home.idleIntro;

  return (
    <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Dialog.Root
        open={conversationOpen}
        onOpenChange={setConversationOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(31rem,calc(100dvh-1.5rem))] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
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
            <form onSubmit={startConversation} className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
                <label htmlFor="new-conversation-intent" className="mb-2 shrink-0 text-sm font-medium text-fg">{copy.intentLabel}</label>
                <textarea
                  id="new-conversation-intent"
                  className="min-h-32 w-full flex-1 resize-none rounded-xl border border-edge bg-surface-base p-3 text-sm font-normal leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  value={intent}
                  onChange={(event) => setIntent(event.target.value)}
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
                  <span className="tabular-nums">{intent.length.toLocaleString()} / {(12_000).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild><Button type="button" variant="ghost">{t.cancel}</Button></Dialog.Close>
                <Button type="submit" variant="primary" className="min-w-32" disabled={!intent.trim()}>
                  <Sparkles className="size-4" aria-hidden />
                  {copy.submit}
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
              <Dialog.Close asChild><Button type="button" variant="ghost" className="size-8 p-0" title={t.cancel} aria-label={t.cancel}><X className="size-4" aria-hidden /></Button></Dialog.Close>
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
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{loadError}</span>
          <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => void load()}>{t.home.retry}</Button>
        </div>
      ) : null}

      {loading ? <HomeSkeleton /> : home ? (
        <div className={isIdle ? 'flex min-h-[calc(100dvh-10rem)] items-center justify-center pb-[12vh]' : ''}>
          <section className={isIdle ? 'w-full max-w-2xl text-center' : 'max-w-3xl'}>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-[2.5rem] sm:leading-[1.12]">{headline}</h2>
            <p className={isIdle
              ? 'mx-auto mt-3 max-w-xl text-sm leading-6 text-fg-muted sm:text-base sm:leading-7'
              : 'mt-3 max-w-2xl text-sm leading-6 text-fg-muted sm:text-base sm:leading-7'}>
              {intro}
            </p>
            {isIdle ? (
              <form
                onSubmit={startConversation}
                className="mx-auto mt-8 w-full max-w-[640px] rounded-2xl border border-edge bg-surface-base p-2 text-left shadow-surface transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15"
              >
                <label htmlFor="idle-conversation-intent" className="sr-only">{copy.intentLabel}</label>
                <textarea
                  id="idle-conversation-intent"
                  className="min-h-24 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle"
                  value={intent}
                  onChange={(event) => setIntent(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={copy.intentPlaceholder}
                  maxLength={12_000}
                />
                <div className="flex items-center justify-end gap-3 border-t border-edge-subtle px-1 pt-2 sm:justify-between">
                  <span className="hidden px-2 text-[11px] text-fg-subtle sm:inline">{t.home.submitShortcut}</span>
                  <Button type="submit" variant="primary" className="h-9 rounded-lg px-3.5 text-xs" disabled={!intent.trim()}>
                    <Sparkles className="size-3.5" aria-hidden />
                    {copy.newWork}
                  </Button>
                </div>
              </form>
            ) : null}
          </section>

          {home.needsUser.length > 0 ? (
            <section className="mt-10" aria-labelledby="home-needs-user-title">
              <div className="mb-3 flex items-center gap-2 px-1">
                <CircleAlert className="size-4 text-warning" aria-hidden />
                <h2 id="home-needs-user-title" className="text-sm font-semibold text-fg">{t.home.needsUserTitle}</h2>
              </div>
              <div className="divide-y divide-edge-subtle overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base">
                {home.needsUser.map((item) => (
                  <DecisionCard
                    key={item.id}
                    item={item}
                    busy={busyItemId === item.id}
                    recommendationLabel={t.home.recommendationLabel}
                    dueLabel={t.home.dueLabel}
                    failureLabel={copy.runAttention}
                    locale={language}
                    onAction={runAction}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {home.background.length > 0 ? (
            <section className="mt-10" aria-labelledby="home-background-title">
              <div className="flex items-center justify-between gap-3 px-1">
                <h2 id="home-background-title" className="text-sm font-semibold text-fg">{t.home.backgroundTitle}</h2>
                <span className="text-xs text-fg-subtle">{interpolate(t.home.backgroundCount, { count: home.backgroundCount })}</span>
              </div>
              <div className="mt-2 divide-y divide-edge-subtle border-y border-edge-subtle">
                {home.background.map((item) => <BackgroundRow key={item.id} item={item} onAction={runAction} />)}
              </div>
              <p className="mt-5 text-xs leading-5 text-fg-subtle">{t.home.autoArchiveNote}</p>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
