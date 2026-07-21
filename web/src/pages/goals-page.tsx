import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  CircleAlert,
  CirclePause,
  CirclePlay,
  Clock3,
  ExternalLink,
  History,
  Inbox,
  ListChecks,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import type { WireAttachment } from '@/features/chat/composer/composer.types';
import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { GoalCreateDialog, normalizeChecklist, type CreateGoalDraft, type GoalCreateOptions, type GoalsPageMessages } from '@/features/goals/goal-create-dialog';
import {
  actionableCounts,
  compareOperationalGoals,
  GOAL_STATUSES,
  goalProgress,
  isLiveQueueStatus,
  latestQueueForGoals,
  matchesGoalSearch,
  queueTime,
  type GoalItem,
  type GoalQueueItem,
  type GoalStatus,
  type WorkbenchSectionId,
  workbenchSectionForGoal,
  WORKBENCH_SECTIONS,
} from '@/features/goals/goals-workbench-model';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { normalizeGoalsConfigFromConfig } from '@/features/settings/goals-config-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

type GoalAction = 'continue' | 'pause' | 'reopen' | 'complete' | 'archive' | 'unarchive';
type GoalsView = 'workbench' | 'all' | 'history';
type GoalIntent = GoalAction | 'details' | 'review' | 'execution';
type UndoRecord = { goalId: string; action: Exclude<GoalAction, 'continue' | 'pause'>; title: string };

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);
}

function formatDateTime(value: number, language: StoredLanguage): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatRelativeTime(value: number, language: StoredLanguage): string {
  const deltaSeconds = Math.round((value - Date.now()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { numeric: 'auto' });
  if (absolute < 60) return formatter.format(deltaSeconds, 'second');
  if (absolute < 3_600) return formatter.format(Math.round(deltaSeconds / 60), 'minute');
  if (absolute < 86_400) return formatter.format(Math.round(deltaSeconds / 3_600), 'hour');
  if (absolute < 2_592_000) return formatter.format(Math.round(deltaSeconds / 86_400), 'day');
  return formatDateTime(value, language);
}

function queueLabel(status: GoalQueueItem['status'], t: GoalsPageMessages): string {
  return t.statuses[status] ?? status;
}

function mainStatus(goal: GoalItem, queueItem: GoalQueueItem | undefined, t: GoalsPageMessages) {
  if (goal.status === 'blocked') return { label: t.workbench.status.blocked, tone: 'attention' as const };
  if (goal.status === 'needs_input') return { label: t.workbench.status.needsInput, tone: 'attention' as const };
  if (queueItem?.status === 'failed') return { label: t.workbench.status.executionFailed, tone: 'attention' as const };
  if (queueItem?.status === 'running') return { label: t.workbench.status.running, tone: 'running' as const };
  if (queueItem?.status === 'queued') return { label: t.workbench.status.queued, tone: 'running' as const };
  if (queueItem?.status === 'retry_waiting') return { label: t.workbench.status.retryWaiting, tone: 'running' as const };
  if (goal.status === 'active') return { label: t.workbench.status.ready, tone: 'ready' as const };
  if (goal.status === 'paused') return { label: t.workbench.status.paused, tone: 'neutral' as const };
  if (goal.status === 'done') return { label: t.workbench.status.done, tone: 'done' as const };
  return { label: t.workbench.status.archived, tone: 'neutral' as const };
}

function statusTone(tone: ReturnType<typeof mainStatus>['tone']): string {
  if (tone === 'attention') return 'bg-warning-soft text-amber-800 dark:text-amber-200';
  if (tone === 'running') return 'bg-accent-soft text-accent-fg';
  if (tone === 'ready') return 'bg-surface-active text-fg';
  if (tone === 'done') return 'bg-success-soft text-emerald-800 dark:text-emerald-200';
  return 'bg-surface-hover text-fg-muted';
}

function primaryIntent(goal: GoalItem, queueItem?: GoalQueueItem): GoalIntent {
  if (goal.status === 'done') return 'review';
  if (goal.status === 'archived') return 'unarchive';
  if (goal.status === 'blocked' || goal.status === 'needs_input') return 'details';
  if (queueItem?.status === 'running' || queueItem?.status === 'queued' || queueItem?.status === 'retry_waiting') return 'execution';
  return 'continue';
}

function intentLabel(intent: GoalIntent, t: GoalsPageMessages): string {
  if (intent === 'details') return t.workbench.actions.handle;
  if (intent === 'review') return t.workbench.actions.review;
  if (intent === 'execution') return t.workbench.actions.viewExecution;
  if (intent === 'continue') return t.workbench.actions.continueExecution;
  return t.actions[intent];
}

function intentIcon(intent: GoalIntent) {
  if (intent === 'details') return CircleAlert;
  if (intent === 'review') return ListChecks;
  if (intent === 'execution') return Clock3;
  if (intent === 'pause') return CirclePause;
  if (intent === 'archive') return Archive;
  if (intent === 'unarchive') return ArchiveRestore;
  if (intent === 'reopen') return RotateCcw;
  if (intent === 'complete') return CheckCircle2;
  return CirclePlay;
}

function supportText(goal: GoalItem, queueItem: GoalQueueItem | undefined, t: GoalsPageMessages): string {
  if (goal.status === 'needs_input') return goal.blockedReason || goal.nextAction || t.workbench.row.inputNeeded;
  if (goal.status === 'blocked') return goal.blockedReason || t.workbench.row.reviewBlocker;
  if (queueItem?.status === 'failed') return queueItem.error || t.workbench.row.executionFailed;
  if (queueItem && isLiveQueueStatus(queueItem.status)) return goal.nextAction || queueItem.userTurn?.text || t.workbench.row.executionInProgress;
  if (goal.status === 'paused') {
    if (goal.blockedReason && goal.blockedReason !== 'user-paused') return goal.blockedReason;
    return t.workbench.row.pausedByUser;
  }
  if (goal.status === 'done') return t.workbench.row.completedReview;
  if (goal.status === 'archived') return t.workbench.row.archived;
  return goal.nextAction || t.noNextAction;
}

function lastExecutionText(queueItem: GoalQueueItem | undefined, language: StoredLanguage, t: GoalsPageMessages): string | null {
  if (!queueItem || isLiveQueueStatus(queueItem.status)) return null;
  const time = formatRelativeTime(queueTime(queueItem), language);
  if (queueItem.status === 'succeeded') return formatMessage(t.workbench.row.lastSucceeded, { time });
  if (queueItem.status === 'failed') return formatMessage(t.workbench.row.lastFailed, { time });
  return formatMessage(t.workbench.row.lastFinished, { time });
}

function checklistGlyph(status: GoalItem['checklist'][number]['status']): string {
  if (status === 'completed') return '✓';
  if (status === 'impossible') return '!';
  return '○';
}

function reverseAction(action: UndoRecord['action']): UndoRecord['action'] {
  if (action === 'archive') return 'unarchive';
  if (action === 'unarchive') return 'archive';
  if (action === 'complete') return 'reopen';
  return 'complete';
}

async function listGoals(): Promise<GoalItem[]> {
  const query = new URLSearchParams({ status: GOAL_STATUSES.join(','), limit: '500' });
  const response = await fetchJson<{ ok: true; goals: GoalItem[] }>(apiUrl(`/api/goals?${query.toString()}`));
  return response.goals;
}

async function fetchGoalQueue(): Promise<GoalQueueItem[]> {
  const response = await fetchJson<{ ok: true; queue: GoalQueueItem[] }>(apiUrl('/api/goals/queue'));
  return response.queue ?? [];
}

async function createGoal(input: {
  title: string;
  contextMessage: { text: string; attachments?: WireAttachment[] };
  priority?: GoalItem['priority'];
  deadlineAt?: number;
  maxTurns?: number;
  agentId?: string;
  judgeModelRef?: string;
  contract?: { objective?: string; scopeBoundary?: string; evidencePlan?: string[]; criteria?: string[] };
}): Promise<GoalItem> {
  const response = await fetchJson<{ ok: true; goal: GoalItem }>(apiUrl('/api/goals'), {
    method: 'POST',
    body: JSON.stringify({ ...input, source: 'api' }),
  });
  return response.goal;
}

async function draftGoalContract(
  input: CreateGoalDraft,
  uiLocale: StoredLanguage,
): Promise<Pick<CreateGoalDraft, 'objective' | 'scopeBoundary' | 'evidencePlan' | 'checklist'>> {
  const response = await fetchJson<{
    ok: true;
    contract: { objective?: string; scopeBoundary?: string; evidencePlan?: string[]; criteria?: string[] };
  }>(apiUrl('/api/goals/contract/draft'), {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      context: input.description,
      criteria: input.checklist,
      judgeModelRef: input.judgeModelRef || undefined,
      uiLocale,
    }),
  });
  return {
    objective: response.contract.objective ?? input.objective,
    scopeBoundary: response.contract.scopeBoundary ?? input.scopeBoundary,
    evidencePlan: response.contract.evidencePlan ?? input.evidencePlan,
    checklist: response.contract.criteria ?? input.checklist,
  };
}

async function postGoalAction(goalId: string, action: Exclude<GoalAction, 'continue'>): Promise<void> {
  await fetchJson(apiUrl(`/api/goals/${encodeURIComponent(goalId)}/${action}`), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

async function continueGoal(goalId: string): Promise<string | undefined> {
  const response = await fetchJson<{ ok: true; sessionKey?: string }>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/continue`),
    { method: 'POST', body: JSON.stringify({}) },
  );
  return response.sessionKey;
}

function GoalActionButton({
  goal,
  queueItem,
  intent,
  t,
  busy,
  onAction,
}: {
  goal: GoalItem;
  queueItem?: GoalQueueItem;
  intent: GoalIntent;
  t: GoalsPageMessages;
  busy: string | null;
  onAction: (goalId: string, action: GoalAction) => void;
}) {
  const Icon = intentIcon(intent);
  const isBusy = busy === `${goal.id}:${intent}`;
  const variant = intent === 'continue' ? 'primary' : 'secondary';

  if (intent === 'details' || intent === 'review') {
    return (
      <Button asChild type="button" variant={variant} className="h-11 rounded-lg px-3.5">
        <Link to={`/goals/${encodeURIComponent(goal.id)}`}>
          <Icon className="size-4" aria-hidden />
          {intentLabel(intent, t)}
        </Link>
      </Button>
    );
  }

  if (intent === 'execution') {
    if (queueItem?.sessionKey) {
      return (
        <Button asChild type="button" variant="secondary" className="h-11 rounded-lg px-3.5">
          <Link to={`/chat/${encodeURIComponent(queueItem.sessionKey)}`}>
            <Icon className="size-4" aria-hidden />
            {intentLabel(intent, t)}
          </Link>
        </Button>
      );
    }
    return (
      <Button asChild type="button" variant="secondary" className="h-11 rounded-lg px-3.5">
        <Link to={`/goals/${encodeURIComponent(goal.id)}`}>
          <Icon className="size-4" aria-hidden />
          {intentLabel(intent, t)}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      className="h-11 rounded-lg px-3.5"
      disabled={isBusy}
      onClick={() => onAction(goal.id, intent)}
    >
      <Icon className={cn('size-4', isBusy && 'animate-pulse')} aria-hidden />
      {isBusy ? t.workbench.actions.working : intentLabel(intent, t)}
    </Button>
  );
}

function GoalRow({
  goal,
  queueItem,
  t,
  language,
  busy,
  actionError,
  onOpen,
  onAction,
}: {
  goal: GoalItem;
  queueItem?: GoalQueueItem;
  t: GoalsPageMessages;
  language: StoredLanguage;
  busy: string | null;
  actionError?: string;
  onOpen: (goal: GoalItem) => void;
  onAction: (goalId: string, action: GoalAction) => void;
}) {
  const status = mainStatus(goal, queueItem, t);
  const intent = primaryIntent(goal, queueItem);
  const progress = goalProgress(goal);
  const updatedAt = queueItem && isLiveQueueStatus(queueItem.status)
    ? queueTime(queueItem)
    : goal.latestRun?.finishedAt ?? goal.updatedAt;
  const lastExecution = lastExecutionText(queueItem, language, t);

  return (
    <article className="group border-b border-edge-subtle py-4 last:border-b-0 sm:py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <button
          type="button"
          className={cn('min-w-0 flex-1 rounded-lg text-left', interaction.focusRingPanel)}
          aria-label={`${t.openDetails}: ${goal.title}`}
          onClick={() => onOpen(goal)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', statusTone(status.tone))}>{status.label}</span>
            {goal.priority === 'high' ? <span className="text-xs font-semibold text-fg">{t.workbench.row.highPriority}</span> : null}
            <span className="text-xs text-fg-subtle">{goal.agentId}</span>
          </div>
          <h3 className="mt-2.5 text-base font-semibold leading-6 text-fg">{goal.title}</h3>
          <p className={cn('mt-1 max-w-[70ch] text-sm leading-6', status.tone === 'attention' ? 'text-amber-800 dark:text-amber-200' : 'text-fg-muted')}>
            {supportText(goal, queueItem, t)}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-fg-subtle">
            <span title={formatDateTime(updatedAt, language)}>{formatRelativeTime(updatedAt, language)}</span>
            <span>{formatMessage(t.turns, { used: goal.turnsUsed, max: goal.maxTurns })}</span>
            {progress.total ? <span>{formatMessage(t.checklistProgress, { done: progress.done, total: progress.total })}</span> : null}
            {goal.deadlineAt ? <span>{formatMessage(t.deadlineSummary, { deadline: formatDateTime(goal.deadlineAt, language) })}</span> : null}
            {lastExecution ? <span>{lastExecution}</span> : null}
            {queueItem && isLiveQueueStatus(queueItem.status) ? (
              <span>{formatMessage(t.attempt, { attempts: queueItem.attempts, max: queueItem.maxRetries + 1 })}</span>
            ) : null}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2 lg:justify-end">
          <GoalActionButton
            goal={goal}
            queueItem={queueItem}
            intent={intent}
            t={t}
            busy={busy}
            onAction={onAction}
          />
          <Button type="button" variant="ghost" className="size-11 shrink-0 rounded-lg p-0" aria-label={t.openDetails} onClick={() => onOpen(goal)}>
            <ExternalLink className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      {actionError ? (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{actionError}</p>
      ) : null}
    </article>
  );
}

function GoalRowsSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="border-b border-edge-subtle py-5 last:border-b-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex gap-2"><Skeleton className="h-6 w-24 rounded-full" /><Skeleton className="h-4 w-16" /></div>
              <Skeleton className="mt-3 h-5 w-2/3" />
              <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
              <Skeleton className="mt-3 h-3 w-72 max-w-full" />
            </div>
            <Skeleton className="h-11 w-32 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GoalSection({
  title,
  description,
  goals,
  queueByGoal,
  t,
  language,
  busy,
  actionError,
  onOpen,
  onAction,
}: {
  title: string;
  description: string;
  goals: GoalItem[];
  queueByGoal: Map<string, GoalQueueItem>;
  t: GoalsPageMessages;
  language: StoredLanguage;
  busy: string | null;
  actionError: { goalId: string; message: string } | null;
  onOpen: (goal: GoalItem) => void;
  onAction: (goalId: string, action: GoalAction) => void;
}) {
  return (
    <section aria-labelledby={`goal-section-${title}`}>
      <header className="flex items-start justify-between gap-4 pb-1">
        <div className="min-w-0">
          <h2 id={`goal-section-${title}`} className="text-base font-semibold text-fg">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-fg-muted">{description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold tabular-nums text-fg-muted">{goals.length}</span>
      </header>
      <div className="mt-2">
        {goals.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            queueItem={queueByGoal.get(goal.id)}
            t={t}
            language={language}
            busy={busy}
            actionError={actionError?.goalId === goal.id ? actionError.message : undefined}
            onOpen={onOpen}
            onAction={onAction}
          />
        ))}
      </div>
    </section>
  );
}

function GoalDetailDialog({
  goal,
  queueItem,
  t,
  language,
  busy,
  onClose,
  onAction,
}: {
  goal: GoalItem | null;
  queueItem?: GoalQueueItem;
  t: GoalsPageMessages;
  language: StoredLanguage;
  busy: string | null;
  onClose: () => void;
  onAction: (goalId: string, action: GoalAction) => void;
}) {
  if (!goal) return null;
  const progress = goalProgress(goal);
  const status = mainStatus(goal, queueItem, t);
  const intent = primaryIntent(goal, queueItem);

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(90vh,48rem)] w-[min(100%-2rem,56rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold leading-6 text-fg">{goal.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{supportText(goal, queueItem, t)}</Dialog.Description>
            </div>
            <Button type="button" variant="ghost" className="size-11 shrink-0 rounded-lg p-0" aria-label={t.closeDetails} onClick={onClose}>
              <X className="size-5" aria-hidden />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', statusTone(status.tone))}>{status.label}</span>
                <span className="text-xs text-fg-muted">{goal.agentId}</span>
                <span className="text-xs text-fg-muted">{formatMessage(t.checklistProgress, { done: progress.done, total: progress.total })}</span>
              </div>
              <GoalActionButton goal={goal} queueItem={queueItem} intent={intent} t={t} busy={busy} onAction={onAction} />
            </div>

            {goal.description ? <p className="mt-6 max-w-[70ch] whitespace-pre-wrap break-words text-sm leading-6 text-fg-muted">{goal.description}</p> : null}

            <section className="mt-7 border-t border-edge-subtle pt-5">
              <h3 className="text-sm font-semibold text-fg">{goal.blockedReason ? t.currentBlocker : t.nextAction}</h3>
              <p className={cn('mt-2 text-sm leading-6', status.tone === 'attention' ? 'text-amber-800 dark:text-amber-200' : 'text-fg-muted')}>
                {supportText(goal, queueItem, t)}
              </p>
            </section>

            {queueItem ? (
              <section className="mt-6 border-t border-edge-subtle pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-fg">{t.workbench.row.latestExecution}</h3>
                  <span className="text-xs font-medium text-fg-muted">{queueLabel(queueItem.status, t)}</span>
                </div>
                <p className="mt-2 text-sm text-fg-muted">
                  {formatMessage(t.attempt, { attempts: queueItem.attempts, max: queueItem.maxRetries + 1 })} · {formatDateTime(queueTime(queueItem), language)}
                </p>
                {queueItem.error ? <p className="mt-2 text-sm text-danger">{queueItem.error}</p> : null}
              </section>
            ) : null}

            <section className="mt-6 border-t border-edge-subtle pt-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><ListChecks className="size-4 text-accent" aria-hidden />{t.checklist}</h3>
              {goal.checklist.length ? (
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-fg-muted">
                  {goal.checklist.map((item) => (
                    <li key={item.id} className="flex gap-2"><span className="w-5 shrink-0 text-center">{checklistGlyph(item.status)}</span><span className="break-words">{item.text}</span></li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-fg-muted">{t.noChecklist}</p>}
            </section>
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge px-5 py-3">
            <div className="flex flex-wrap gap-2">
              {goal.status === 'active' ? <Button type="button" variant="ghost" className="h-11 rounded-lg" onClick={() => onAction(goal.id, 'pause')}><CirclePause className="size-4" aria-hidden />{t.actions.pause}</Button> : null}
              {goal.status !== 'archived' ? <Button type="button" variant="ghost" className="h-11 rounded-lg" onClick={() => onAction(goal.id, 'archive')}><Archive className="size-4" aria-hidden />{t.actions.archive}</Button> : null}
            </div>
            <Button asChild type="button" variant="secondary" className="h-11 rounded-lg">
              <Link to={`/goals/${encodeURIComponent(goal.id)}`}><ExternalLink className="size-4" aria-hidden />{t.fullDetails}</Link>
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GoalsPage() {
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).goalsPage;
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [queue, setQueue] = useState<GoalQueueItem[]>([]);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<GoalsView>('workbench');
  const [agentFilter, setAgentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ goalId: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoRecord | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [createOptions, setCreateOptions] = useState<GoalCreateOptions>({
    defaultAgentId: '',
    agents: [],
    models: [],
    checklistDecomposePolicy: 'empty_only',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextGoals, nextQueue] = await Promise.all([listGoals(), fetchGoalQueue()]);
      setGoals(nextGoals);
      setQueue(nextQueue);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.load);
    } finally {
      setLoading(false);
    }
  }, [t.errors.load]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function loadCreateOptions() {
      const [agentsResult, modelsResult, configResult] = await Promise.allSettled([
        fetchGatewayAgents(),
        fetchConfiguredModelsCached(),
        fetchGatewayConfigSwrResponse(),
      ]);
      if (cancelled) return;
      setCreateOptions((previous) => {
        const defaultAgentId = agentsResult.status === 'fulfilled' ? agentsResult.value.defaultId : previous.defaultAgentId;
        const agents = agentsResult.status === 'fulfilled' ? agentsResult.value.agents : previous.agents;
        return {
          defaultAgentId,
          agents: agents.length ? agents : [{
            id: defaultAgentId || 'main', workspace: '', profileDir: '', typedModels: { defaultRole: 'deep', preset: [], effective: [] },
            extends: [], isDefault: true, skills: { preset: [] }, tools: { presetDenied: [], entryDisable: [], effectiveDisable: [] },
          }],
          models: modelsResult.status === 'fulfilled' ? modelsResult.value : previous.models,
          checklistDecomposePolicy: configResult.status === 'fulfilled'
            ? normalizeGoalsConfigFromConfig(configResult.value.payload?.config).checklistDecomposePolicy
            : previous.checklistDecomposePolicy,
        };
      });
    }
    void loadCreateOptions();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener('goal-queue-updated', handler);
    window.addEventListener('goal-status-updated', handler);
    return () => {
      window.removeEventListener('goal-queue-updated', handler);
      window.removeEventListener('goal-status-updated', handler);
    };
  }, [refresh]);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const queueByGoal = useMemo(() => latestQueueForGoals(queue), [queue]);
  const searchedGoals = useMemo(() => goals.filter((goal) => matchesGoalSearch(goal, query)), [goals, query]);
  const counts = useMemo(() => actionableCounts(goals, queueByGoal), [goals, queueByGoal]);
  const selectedGoal = useMemo(() => goals.find((goal) => goal.id === selectedGoalId) ?? null, [goals, selectedGoalId]);
  const agents = useMemo(() => [...new Set(goals.map((goal) => goal.agentId))].sort(), [goals]);

  const workbenchGroups = useMemo(() => {
    const groups = new Map<WorkbenchSectionId, GoalItem[]>(WORKBENCH_SECTIONS.map((section) => [section, []]));
    for (const goal of searchedGoals) {
      const section = workbenchSectionForGoal(goal, queueByGoal.get(goal.id));
      if (section) groups.get(section)?.push(goal);
    }
    for (const section of WORKBENCH_SECTIONS) groups.get(section)?.sort((a, b) => compareOperationalGoals(a, b, queueByGoal));
    return groups;
  }, [queueByGoal, searchedGoals]);

  const openGoals = useMemo(() => searchedGoals
    .filter((goal) => goal.status !== 'done' && goal.status !== 'archived')
    .filter((goal) => !agentFilter || goal.agentId === agentFilter)
    .filter((goal) => !statusFilter || goal.status === statusFilter)
    .filter((goal) => !priorityFilter || goal.priority === priorityFilter)
    .sort((a, b) => compareOperationalGoals(a, b, queueByGoal)), [agentFilter, priorityFilter, queueByGoal, searchedGoals, statusFilter]);

  const historyGoals = useMemo(() => searchedGoals
    .filter((goal) => goal.status === 'done' || goal.status === 'archived')
    .sort((a, b) => b.updatedAt - a.updatedAt), [searchedGoals]);

  const importantGoal = workbenchGroups.get('attention')?.[0]
    ?? workbenchGroups.get('running')?.[0]
    ?? workbenchGroups.get('ready')?.[0]
    ?? null;

  const hero = counts.attention > 0
    ? {
      title: counts.attention === 1
        ? t.workbench.hero.attentionOne
        : formatMessage(t.workbench.hero.attentionMany, { count: counts.attention }),
      description: t.workbench.hero.attentionDescription,
    }
    : counts.running > 0
      ? {
        title: counts.running === 1
          ? t.workbench.hero.runningOne
          : formatMessage(t.workbench.hero.runningMany, { count: counts.running }),
        description: t.workbench.hero.runningDescription,
      }
      : counts.ready > 0
        ? {
          title: counts.ready === 1
            ? t.workbench.hero.readyOne
            : formatMessage(t.workbench.hero.readyMany, { count: counts.ready }),
          description: t.workbench.hero.readyDescription,
        }
        : {
          title: t.workbench.hero.calm,
          description: counts.later > 0
            ? formatMessage(t.workbench.hero.calmDescriptionWithPaused, { paused: counts.later })
            : t.workbench.hero.calmDescription,
        };

  const runAction = useCallback(async (goalId: string, action: GoalAction, options?: { skipUndo?: boolean }) => {
    const goal = goals.find((item) => item.id === goalId);
    setBusy(`${goalId}:${action}`);
    setActionError(null);
    try {
      if (action === 'continue') {
        const sessionKey = await continueGoal(goalId);
        if (sessionKey) {
          navigate(`/chat/${encodeURIComponent(sessionKey)}`);
          return;
        }
      } else {
        await postGoalAction(goalId, action);
        if (!options?.skipUndo && goal && (action === 'archive' || action === 'unarchive' || action === 'complete' || action === 'reopen')) {
          setUndo({ goalId, action, title: goal.title });
        }
      }
      await refresh();
    } catch (error) {
      setActionError({ goalId, message: error instanceof Error ? error.message : t.errors.action });
    } finally {
      setBusy(null);
    }
  }, [goals, navigate, refresh, t.errors.action]);

  const createFromDraft = useCallback(async (draft: CreateGoalDraft) => {
    const maxTurns = Number.parseInt(draft.maxTurns, 10);
    const deadlineAt = draft.deadline ? new Date(draft.deadline).getTime() : undefined;
    setBusy('create');
    setLoadError(null);
    try {
      const goal = await createGoal({
        title: draft.title.trim(),
        contextMessage: { text: draft.description.trim(), attachments: draft.attachments.length ? draft.attachments : undefined },
        priority: draft.priority,
        deadlineAt: Number.isFinite(deadlineAt) ? deadlineAt : undefined,
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
        agentId: draft.agentId.trim() || undefined,
        judgeModelRef: draft.judgeModelRef.trim() || undefined,
        contract: {
          objective: draft.objective.trim() || draft.title.trim(),
          scopeBoundary: draft.scopeBoundary.trim() || undefined,
          evidencePlan: normalizeChecklist(draft.evidencePlan),
          criteria: normalizeChecklist(draft.checklist),
        },
      });
      await refresh();
      setSelectedGoalId(goal.id);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.create);
      throw error;
    } finally {
      setBusy(null);
    }
  }, [refresh, t.errors.create]);

  const headerEnd = useMemo(() => (
    <>
      <label className="relative min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t.searchPlaceholder}
          autoComplete="off"
          placeholder={t.searchPlaceholder}
          className="h-10 w-36 rounded-lg border border-edge bg-surface-muted py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent sm:w-56 lg:w-72"
        />
      </label>
      <RefreshButton className="size-10 shrink-0 p-0" loading={loading} label={t.refresh} onClick={refresh} />
      <Button type="button" variant="primary" className="h-10 rounded-lg" disabled={busy === 'create'} onClick={() => setCreateDialogOpen(true)}>
        <Plus className="size-4" aria-hidden />{t.create}
      </Button>
    </>
  ), [busy, loading, query, refresh, t.create, t.refresh, t.searchPlaceholder]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <div className="min-w-0"><h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1><p className="truncate text-xs text-fg-muted">{t.workbench.pageDescription}</p></div>,
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, setPageHeader, t.title, t.workbench.pageDescription]);

  const tabs = [
    { id: 'workbench' as const, label: t.workbench.tabs.workbench, icon: Inbox, count: counts.attention + counts.running + counts.ready },
    { id: 'all' as const, label: t.workbench.tabs.all, icon: ListChecks, count: goals.length - counts.history },
    { id: 'history' as const, label: t.workbench.tabs.history, icon: History, count: counts.history },
  ];

  const sectionMessages: Record<WorkbenchSectionId, { title: string; description: string }> = t.workbench.sections;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-panel">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-3 py-5 sm:px-6 lg:px-8">
        <section className="rounded-xl border border-edge bg-surface-base px-4 py-5 sm:px-6 sm:py-6" aria-labelledby="goals-now-title">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 max-w-2xl">
              <p className="text-sm font-medium text-fg-muted">{t.workbench.hero.eyebrow}</p>
              <h2 id="goals-now-title" className="mt-1.5 text-xl font-semibold tracking-tight text-fg sm:text-2xl">{hero.title}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{hero.description}</p>
            </div>
            {importantGoal ? (
              <div className="flex min-w-0 flex-col gap-3 border-t border-edge-subtle pt-4 lg:max-w-md lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-fg-subtle">{t.workbench.hero.nextFocus}</p>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-fg">{importantGoal.title}</p>
                </div>
                <GoalActionButton
                  goal={importantGoal}
                  queueItem={queueByGoal.get(importantGoal.id)}
                  intent={primaryIntent(importantGoal, queueByGoal.get(importantGoal.id))}
                  t={t}
                  busy={busy}
                  onAction={(goalId, action) => void runAction(goalId, action)}
                />
              </div>
            ) : null}
          </div>
        </section>

        <div className="mt-5 border-b border-edge-subtle">
          <PageTabs
            items={tabs}
            activeTab={view}
            onChange={setView}
            ariaLabel={t.workbench.tabs.label}
            tabIdPrefix="goals-tab"
            panelIdPrefix="goals-panel"
            className="pb-2"
            selectedClassName="bg-surface-active text-fg"
          />
        </div>

        {loadError ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>{loadError}</span><Button type="button" variant="secondary" className="h-10 rounded-lg" onClick={() => void refresh()}>{t.workbench.actions.retryLoad}</Button>
          </div>
        ) : null}

        <section id={`goals-panel-${view}`} role="tabpanel" aria-labelledby={`goals-tab-${view}`} className="min-h-0 flex-1 overflow-y-auto pb-12 pt-5">
          {loading && goals.length === 0 ? <GoalRowsSkeleton /> : null}

          {!loading && view === 'workbench' ? (
            <div className="grid gap-9">
              {(['attention', 'running', 'ready'] as WorkbenchSectionId[]).map((section) => {
                const sectionGoals = workbenchGroups.get(section) ?? [];
                if (sectionGoals.length === 0) return null;
                return (
                  <GoalSection
                    key={section}
                    {...sectionMessages[section]}
                    goals={sectionGoals}
                    queueByGoal={queueByGoal}
                    t={t}
                    language={language}
                    busy={busy}
                    actionError={actionError}
                    onOpen={(goal) => setSelectedGoalId(goal.id)}
                    onAction={(goalId, action) => void runAction(goalId, action)}
                  />
                );
              })}

              {(workbenchGroups.get('attention')?.length ?? 0) + (workbenchGroups.get('running')?.length ?? 0) + (workbenchGroups.get('ready')?.length ?? 0) === 0 ? (
                <div className="rounded-xl border border-edge-subtle bg-surface-base px-5 py-8 text-center">
                  <CheckCircle2 className="mx-auto size-6 text-success" aria-hidden />
                  <h2 className="mt-3 text-base font-semibold text-fg">{t.workbench.empty.healthyTitle}</h2>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-fg-muted">
                    {counts.later > 0
                      ? formatMessage(t.workbench.empty.healthyDescriptionWithPaused, { paused: counts.later })
                      : t.workbench.empty.healthyDescription}
                  </p>
                </div>
              ) : null}

              {(workbenchGroups.get('later')?.length ?? 0) > 0 ? (
                <details className="group border-t border-edge-subtle pt-5">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-sm font-semibold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    <span>{sectionMessages.later.title}</span>
                    <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs tabular-nums text-fg-muted">{workbenchGroups.get('later')?.length}</span>
                  </summary>
                  <p className="mt-1 px-1 text-sm text-fg-muted">{sectionMessages.later.description}</p>
                  <div className="mt-2">
                    {(workbenchGroups.get('later') ?? []).map((goal) => (
                      <GoalRow key={goal.id} goal={goal} queueItem={queueByGoal.get(goal.id)} t={t} language={language} busy={busy} actionError={actionError?.goalId === goal.id ? actionError.message : undefined} onOpen={(item) => setSelectedGoalId(item.id)} onAction={(goalId, action) => void runAction(goalId, action)} />
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          {!loading && view === 'all' ? (
            <div>
              <div className="flex flex-wrap gap-2 border-b border-edge-subtle pb-4">
                <Select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} className="w-full sm:w-44" aria-label={t.workbench.filters.agent}>
                  <SelectOption value="">{t.workbench.filters.allAgents}</SelectOption>
                  {agents.map((agent) => <SelectOption key={agent} value={agent}>{agent}</SelectOption>)}
                </Select>
                <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full sm:w-44" aria-label={t.workbench.filters.status}>
                  <SelectOption value="">{t.workbench.filters.allStatuses}</SelectOption>
                  {(['active', 'paused', 'blocked', 'needs_input'] as GoalStatus[]).map((status) => <SelectOption key={status} value={status}>{t.statuses[status]}</SelectOption>)}
                </Select>
                <Select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="w-full sm:w-44" aria-label={t.workbench.filters.priority}>
                  <SelectOption value="">{t.workbench.filters.allPriorities}</SelectOption>
                  {(['high', 'normal', 'low'] as GoalItem['priority'][]).map((priority) => <SelectOption key={priority} value={priority}>{t.priorities[priority]}</SelectOption>)}
                </Select>
                {agentFilter || statusFilter || priorityFilter ? <Button type="button" variant="ghost" className="h-10 rounded-lg" onClick={() => { setAgentFilter(''); setStatusFilter(''); setPriorityFilter(''); }}>{t.workbench.filters.clear}</Button> : null}
              </div>
              {openGoals.length ? openGoals.map((goal) => <GoalRow key={goal.id} goal={goal} queueItem={queueByGoal.get(goal.id)} t={t} language={language} busy={busy} actionError={actionError?.goalId === goal.id ? actionError.message : undefined} onOpen={(item) => setSelectedGoalId(item.id)} onAction={(goalId, action) => void runAction(goalId, action)} />) : (
                <div className="py-14 text-center"><p className="text-sm font-medium text-fg">{t.workbench.empty.noOpenTitle}</p><p className="mt-2 text-sm text-fg-muted">{t.workbench.empty.noOpenDescription}</p></div>
              )}
            </div>
          ) : null}

          {!loading && view === 'history' ? (
            <div>
              <header className="border-b border-edge-subtle pb-4"><h2 className="text-base font-semibold text-fg">{t.workbench.history.title}</h2><p className="mt-1 text-sm text-fg-muted">{t.workbench.history.description}</p></header>
              {historyGoals.length ? historyGoals.map((goal) => <GoalRow key={goal.id} goal={goal} queueItem={queueByGoal.get(goal.id)} t={t} language={language} busy={busy} actionError={actionError?.goalId === goal.id ? actionError.message : undefined} onOpen={(item) => setSelectedGoalId(item.id)} onAction={(goalId, action) => void runAction(goalId, action)} />) : (
                <div className="py-14 text-center"><p className="text-sm font-medium text-fg">{t.workbench.empty.noHistoryTitle}</p><p className="mt-2 text-sm text-fg-muted">{t.workbench.empty.noHistoryDescription}</p></div>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {undo ? (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-edge bg-surface-panel px-4 py-3 shadow-popover" role="status" aria-live="polite">
          <p className="min-w-0 text-sm text-fg">{formatMessage(t.workbench.undo.message, { title: undo.title })}</p>
          <Button type="button" variant="ghost" className="h-10 shrink-0 rounded-lg text-accent-fg" onClick={() => { const current = undo; setUndo(null); void runAction(current.goalId, reverseAction(current.action), { skipUndo: true }); }}>{t.workbench.undo.action}</Button>
          <Button type="button" variant="ghost" className="size-10 shrink-0 rounded-lg p-0" aria-label={t.workbench.undo.dismiss} onClick={() => setUndo(null)}><X className="size-4" aria-hidden /></Button>
        </div>
      ) : null}

      <GoalCreateDialog open={createDialogOpen} t={t} chat={messages(language).chat} busy={busy === 'create'} options={createOptions} onClose={() => setCreateDialogOpen(false)} onCreate={createFromDraft} onDraftContract={(draft) => draftGoalContract(draft, language)} />
      <GoalDetailDialog goal={selectedGoal} queueItem={selectedGoal ? queueByGoal.get(selectedGoal.id) : undefined} t={t} language={language} busy={busy} onClose={() => setSelectedGoalId(null)} onAction={(goalId, action) => void runAction(goalId, action)} />
    </main>
  );
}
