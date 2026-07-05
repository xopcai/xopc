import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  CirclePause,
  CirclePlay,
  Clock3,
  ExternalLink,
  LayoutGrid,
  ListChecks,
  ListFilter,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { fetchConfiguredModelsCached, type ConfiguredModel } from '@/features/chat/api/registry-api';
import { ComposerAttachmentChips } from '@/features/chat/composer/composer-attachment-chips';
import type { WireAttachment } from '@/features/chat/composer/composer.types';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { fetchGatewayAgents, type GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { normalizeGoalsConfigFromConfig, type GoalsConfigState } from '@/features/settings/goals-config-api';
import { messages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { Select, SelectGroup, SelectOption } from '@/components/ui/popover-select';

type GoalStatus = 'active' | 'paused' | 'blocked' | 'needs_input' | 'done' | 'archived';
type GoalBoardLaneId = 'active' | 'paused' | 'attention' | 'done' | 'archived';
type GoalAction = 'continue' | 'pause' | 'resume' | 'reopen' | 'complete' | 'archive' | 'unarchive';
type GoalsViewMode = 'focus' | 'board';
type FocusSectionId = 'attention' | 'running' | 'active' | 'paused' | 'recentDone';

type GoalItem = {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;
  agentId: string;
  priority: 'low' | 'normal' | 'high';
  deadlineAt?: number;
  createdAt: number;
  updatedAt: number;
  turnsUsed: number;
  maxTurns: number;
  nextAction?: string;
  blockedReason?: string;
  activeSessionKey?: string;
  checklist: Array<{ id: string; text: string; status: 'pending' | 'completed' | 'impossible' }>;
  latestRun?: { verdict?: string; reason?: string; finishedAt?: number; startedAt: number };
};

type GoalQueueItem = {
  id: string;
  goalId: string;
  status: 'queued' | 'running' | 'retry_waiting' | 'succeeded' | 'failed' | 'skipped';
  source: 'manual' | 'cron' | 'workflow' | 'api';
  userTurn?: { text?: string };
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  nextRunAt?: number;
  attempts: number;
  maxRetries: number;
  sessionKey?: string;
  error?: string;
};

type GoalsPageMessages = ReturnType<typeof messages>['goalsPage'];
type ChatMessages = ReturnType<typeof messages>['chat'];
type CreateGoalDraft = {
  title: string;
  description: string;
  attachments: WireAttachment[];
  checklist: string[];
  priority: GoalItem['priority'];
  deadlineMode: 'none' | 'today' | 'tomorrow' | 'friday' | 'custom';
  deadline: string;
  maxTurns: string;
  agentId: string;
  judgeModelRef: string;
};

type GoalCreateOptions = {
  defaultAgentId: string;
  agents: GatewayAgentRow[];
  models: ConfiguredModel[];
  checklistDecomposePolicy: GoalsConfigState['checklistDecomposePolicy'];
};

const BOARD_STATUSES: GoalStatus[] = ['active', 'paused', 'blocked', 'needs_input', 'done', 'archived'];
const BOARD_LANES: GoalBoardLaneId[] = ['active', 'paused', 'attention', 'done', 'archived'];
const FOCUS_SECTIONS: FocusSectionId[] = ['attention', 'running', 'active', 'paused', 'recentDone'];
const DRAG_TYPE = 'application/x-xopc-goal-id';

function progress(goal: GoalItem): { done: number; total: number } {
  const total = goal.checklist.length;
  const done = goal.checklist.filter((it) => it.status === 'completed' || it.status === 'impossible').length;
  return { done, total };
}

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);
}

function formatDateTime(value: number, language: StoredLanguage): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusLabel(status: GoalStatus | GoalQueueItem['status'], t: GoalsPageMessages): string {
  return t.statuses[status] ?? status;
}

function laneForGoal(goal: GoalItem): GoalBoardLaneId {
  if (goal.status === 'blocked' || goal.status === 'needs_input') return 'attention';
  return goal.status;
}

function statusClass(status: GoalStatus): string {
  if (status === 'active') return 'bg-accent-soft text-accent-fg';
  if (status === 'paused') return 'bg-surface-hover text-fg-muted';
  if (status === 'done') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'archived') return 'bg-surface-muted text-fg-subtle';
  return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

function checklistGlyph(status: GoalItem['checklist'][number]['status']): string {
  if (status === 'completed') return '✓';
  if (status === 'impossible') return '!';
  return '○';
}

function queueTime(item: GoalQueueItem): number {
  return item.nextRunAt ?? item.finishedAt ?? item.startedAt ?? item.enqueuedAt;
}

function queueRank(item: GoalQueueItem): number {
  if (item.status === 'running') return 6;
  if (item.status === 'retry_waiting') return 5;
  if (item.status === 'queued') return 4;
  if (item.status === 'failed') return 3;
  if (item.status === 'succeeded') return 2;
  return 1;
}

function queueForGoals(queue: GoalQueueItem[]): Map<string, GoalQueueItem> {
  const byGoal = new Map<string, GoalQueueItem>();
  for (const item of queue) {
    const current = byGoal.get(item.goalId);
    if (!current || queueRank(item) > queueRank(current) || (queueRank(item) === queueRank(current) && queueTime(item) > queueTime(current))) {
      byGoal.set(item.goalId, item);
    }
  }
  return byGoal;
}

function queueTone(status: GoalQueueItem['status']): string {
  if (status === 'running') return 'bg-accent-soft text-accent-fg';
  if (status === 'retry_waiting' || status === 'failed') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'succeeded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  return 'bg-surface-hover text-fg-muted';
}

function isActiveQueueStatus(status: GoalQueueItem['status']): boolean {
  return status === 'running' || status === 'queued' || status === 'retry_waiting';
}

function focusSectionForGoal(goal: GoalItem, queueItem?: GoalQueueItem): FocusSectionId | null {
  if (goal.status === 'archived') return null;
  if (goal.status === 'blocked' || goal.status === 'needs_input' || queueItem?.status === 'failed') return 'attention';
  if (queueItem && isActiveQueueStatus(queueItem.status)) return 'running';
  if (goal.status === 'active') return 'active';
  if (goal.status === 'paused') return 'paused';
  if (goal.status === 'done') return 'recentDone';
  return null;
}

function priorityRank(priority: GoalItem['priority']): number {
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  return 1;
}

function compareGoalsForFocus(a: GoalItem, b: GoalItem, queueByGoal: Map<string, GoalQueueItem>): number {
  const qa = queueByGoal.get(a.id);
  const qb = queueByGoal.get(b.id);
  const queueDiff = (qa ? queueRank(qa) : 0) - (qb ? queueRank(qb) : 0);
  if (queueDiff !== 0) return -queueDiff;
  const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDiff !== 0) return -priorityDiff;
  const aDeadline = a.deadlineAt ?? Number.POSITIVE_INFINITY;
  const bDeadline = b.deadlineAt ?? Number.POSITIVE_INFINITY;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  return b.updatedAt - a.updatedAt;
}

function matchesSearch(goal: GoalItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    goal.title,
    goal.description,
    goal.nextAction,
    goal.blockedReason,
    goal.latestRun?.reason,
    ...goal.checklist.map((item) => item.text),
  ].filter(Boolean).join('\n').toLowerCase().includes(q);
}

async function listGoals(): Promise<GoalItem[]> {
  const q = new URLSearchParams({ status: BOARD_STATUSES.join(','), limit: '500' });
  const res = await fetchJson<{ ok: true; goals: GoalItem[] }>(apiUrl(`/api/goals?${q.toString()}`));
  return res.goals;
}

async function fetchGoalQueue(): Promise<GoalQueueItem[]> {
  const res = await fetchJson<{ ok: true; queue: GoalQueueItem[] }>(apiUrl('/api/goals/queue'));
  return res.queue ?? [];
}

async function createGoal(input: {
  title: string;
  contextMessage: {
    text: string;
    attachments?: WireAttachment[];
  };
  priority?: GoalItem['priority'];
  deadlineAt?: number;
  maxTurns?: number;
  agentId?: string;
  judgeModelRef?: string;
}): Promise<GoalItem> {
  const res = await fetchJson<{ ok: true; goal: GoalItem }>(apiUrl('/api/goals'), {
    method: 'POST',
    body: JSON.stringify({ ...input, source: 'api' }),
  });
  return res.goal;
}

async function addGoalChecklistItem(goalId: string, text: string): Promise<void> {
  await fetchJson(apiUrl(`/api/goals/${encodeURIComponent(goalId)}/checklist`), {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

async function postGoalAction(goalId: string, action: Exclude<GoalAction, 'continue'>): Promise<void> {
  await fetchJson(apiUrl(`/api/goals/${encodeURIComponent(goalId)}/${action}`), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

async function continueGoal(goalId: string): Promise<string | undefined> {
  const res = await fetchJson<{ ok: true; sessionKey?: string }>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/continue`),
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
  return res.sessionKey;
}

function primaryAction(goal: GoalItem): GoalAction | null {
  if (goal.status === 'active') return 'continue';
  if (goal.status === 'paused' || goal.status === 'blocked' || goal.status === 'needs_input') return 'resume';
  if (goal.status === 'done') return 'reopen';
  if (goal.status === 'archived') return 'unarchive';
  return null;
}

function secondaryActions(goal: GoalItem): GoalAction[] {
  if (goal.status === 'active') return ['pause', 'complete', 'archive'];
  if (goal.status === 'paused' || goal.status === 'blocked' || goal.status === 'needs_input') return ['archive'];
  if (goal.status === 'done') return ['archive'];
  return [];
}

function actionLabel(action: GoalAction, t: GoalsPageMessages): string {
  return t.actions[action];
}

function actionIcon(action: GoalAction) {
  if (action === 'pause') return CirclePause;
  if (action === 'archive') return Archive;
  if (action === 'unarchive') return ArchiveRestore;
  if (action === 'reopen') return RotateCcw;
  if (action === 'complete') return CheckCircle2;
  return CirclePlay;
}

function dragAction(goal: GoalItem, lane: GoalBoardLaneId): Exclude<GoalAction, 'continue'> | null {
  const current = laneForGoal(goal);
  if (current === lane) return null;
  if (lane === 'active') {
    if (goal.status === 'done') return 'reopen';
    if (goal.status === 'archived') return 'unarchive';
    return 'resume';
  }
  if (lane === 'paused') {
    if (goal.status === 'archived') return 'unarchive';
    return 'pause';
  }
  if (lane === 'done') return 'complete';
  if (lane === 'archived') return 'archive';
  return null;
}

function GoalCard({
  goal,
  queueItem,
  t,
  language,
  selected,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  goal: GoalItem;
  queueItem?: GoalQueueItem;
  t: GoalsPageMessages;
  language: StoredLanguage;
  selected: boolean;
  dragging: boolean;
  onOpen: (goal: GoalItem) => void;
  onDragStart: (goalId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const p = progress(goal);
  const updatedAt = goal.latestRun?.finishedAt ?? goal.updatedAt;

  return (
    <article
      draggable
      onDragStart={(event) => onDragStart(goal.id, event)}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-surface-panel p-3.5 transition-colors',
        selected ? 'border-accent/70 ring-1 ring-accent/30' : 'border-edge',
        dragging ? 'opacity-50' : 'hover:border-edge-strong hover:bg-surface-hover/50',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(goal)}
        aria-label={`${t.openDetails}: ${goal.title}`}
        aria-current={selected ? 'true' : undefined}
        className={cn('w-full text-left', interaction.focusRingPanel)}
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="line-clamp-2 text-sm font-semibold leading-5 text-fg">{goal.title}</div>
            <div className="mt-1 truncate text-[11px] font-medium text-fg-muted">{goal.agentId}</div>
          </div>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm', statusClass(goal.status))}>
            {statusLabel(goal.status, t)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
          <span>{formatDateTime(updatedAt, language)}</span>
          <span aria-hidden>·</span>
          <span>{formatMessage(t.turns, { used: goal.turnsUsed, max: goal.maxTurns })}</span>
          {p.total ? (
            <>
              <span aria-hidden>·</span>
              <span>{formatMessage(t.checklistProgress, { done: p.done, total: p.total })}</span>
            </>
          ) : null}
        </div>

        {queueItem ? (
          <div className="mt-2.5">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', queueTone(queueItem.status))}>
              {statusLabel(queueItem.status, t)}
            </span>
          </div>
        ) : null}

        {goal.blockedReason ? <p className="mt-2 line-clamp-2 text-xs text-amber-700 dark:text-amber-300">{goal.blockedReason}</p> : null}
        {goal.nextAction ? <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{goal.nextAction}</p> : null}
        {!goal.blockedReason && !goal.nextAction && goal.latestRun?.reason ? (
          <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{goal.latestRun.reason}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
          {goal.checklist.length ? (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 font-medium text-fg-muted">
              {formatMessage(t.checklistProgress, { done: p.done, total: p.total })}
            </span>
          ) : null}
          {selected ? <span className="font-medium text-accent-fg">{t.openDetails}</span> : null}
        </div>
      </button>
    </article>
  );
}

function FocusGoalRow({
  goal,
  queueItem,
  t,
  language,
  busy,
  selected,
  onOpen,
  onAction,
}: {
  goal: GoalItem;
  queueItem?: GoalQueueItem;
  t: GoalsPageMessages;
  language: StoredLanguage;
  busy: string | null;
  selected: boolean;
  onOpen: (goal: GoalItem) => void;
  onAction: (goalId: string, action: GoalAction) => void;
}) {
  const p = progress(goal);
  const primary = primaryAction(goal);
  const attentionText = goal.blockedReason || goal.nextAction || goal.latestRun?.reason || t.noNextAction;
  const updatedAt = goal.latestRun?.finishedAt ?? goal.updatedAt;

  return (
    <article
      className={cn(
        'rounded-lg border bg-surface-panel transition-colors hover:border-edge-strong hover:bg-surface-hover/40',
        selected ? 'border-accent/70 ring-1 ring-accent/30' : 'border-edge',
      )}
    >
      <div className="flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center">
        <button
          type="button"
          className={cn('min-w-0 flex-1 text-left', interaction.focusRingPanel)}
          aria-label={`${t.openDetails}: ${goal.title}`}
          onClick={() => onOpen(goal)}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', statusClass(goal.status))}>
              {statusLabel(goal.status, t)}
            </span>
            {queueItem ? (
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', queueTone(queueItem.status))}>
                {statusLabel(queueItem.status, t)}
              </span>
            ) : null}
            <span className="text-[11px] font-medium text-fg-muted">{formatMessage(t.prioritySummary, { priority: t.priorities[goal.priority] })}</span>
            <span className="text-[11px] text-fg-subtle">{goal.agentId}</span>
          </div>
          <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-fg">{goal.title}</h3>
          <p className={cn('mt-1 line-clamp-2 text-sm leading-5', goal.blockedReason ? 'text-amber-700 dark:text-amber-300' : 'text-fg-muted')}>
            {attentionText}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-subtle">
            <span>{formatDateTime(updatedAt, language)}</span>
            <span>{formatMessage(t.turns, { used: goal.turnsUsed, max: goal.maxTurns })}</span>
            {p.total ? <span>{formatMessage(t.checklistProgress, { done: p.done, total: p.total })}</span> : null}
            {goal.deadlineAt ? <span>{formatMessage(t.deadlineSummary, { deadline: formatDateTime(goal.deadlineAt, language) })}</span> : null}
            {queueItem ? <span>{formatMessage(t.sourceSummary, { source: t.sources[queueItem.source] })}</span> : null}
          </div>
        </button>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {primary ? (
            <GoalActionButton
              goalId={goal.id}
              action={primary}
              t={t}
              busy={busy}
              variant={primary === 'continue' ? 'primary' : 'secondary'}
              onAction={onAction}
            />
          ) : null}
          <Button asChild type="button" variant="ghost" className="h-9 rounded-lg px-3">
            <Link to={`/goals/${encodeURIComponent(goal.id)}`}>
              <ExternalLink className="size-4" aria-hidden />
              {t.fullDetails}
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function GoalActionButton({
  goalId,
  action,
  t,
  busy,
  variant,
  onAction,
}: {
  goalId: string;
  action: GoalAction;
  t: GoalsPageMessages;
  busy: string | null;
  variant: 'primary' | 'secondary' | 'ghost';
  onAction: (goalId: string, action: GoalAction) => void;
}) {
  const Icon = actionIcon(action);
  return (
    <Button
      type="button"
      variant={variant}
      className="h-9 rounded-lg px-3 text-sm"
      disabled={busy != null}
      onClick={() => onAction(goalId, action)}
    >
      <Icon className="size-4" aria-hidden />
      {actionLabel(action, t)}
    </Button>
  );
}

function emptyCreateDraft(): CreateGoalDraft {
  return {
    title: '',
    description: '',
    attachments: [],
    checklist: [''],
    priority: 'normal',
    deadlineMode: 'none',
    deadline: '',
    maxTurns: '10',
    agentId: '',
    judgeModelRef: '',
  };
}

function formatDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

function endOfLocalDay(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(23, 59, 0, 0);
  return formatDatetimeLocal(date);
}

function endOfThisFriday(): string {
  const date = new Date();
  const day = date.getDay();
  const friday = 5;
  const daysUntilFriday = day <= friday ? friday - day : 7 - day + friday;
  date.setDate(date.getDate() + daysUntilFriday);
  date.setHours(23, 59, 0, 0);
  return formatDatetimeLocal(date);
}

function nextDeadlineForMode(mode: CreateGoalDraft['deadlineMode']): string {
  if (mode === 'today') return endOfLocalDay(0);
  if (mode === 'tomorrow') return endOfLocalDay(1);
  if (mode === 'friday') return endOfThisFriday();
  if (mode === 'custom') {
    const date = new Date();
    date.setHours(date.getHours() + 1, 0, 0, 0);
    return formatDatetimeLocal(date);
  }
  return '';
}

function aiChecklistDraft(draft: CreateGoalDraft, t: GoalsPageMessages): string[] {
  const subject = draft.title.trim() || t.createDialog.goalFallback;
  return t.createDialog.aiChecklistTemplates.map((template) => formatMessage(template, { goal: subject }));
}

function normalizeChecklist(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const text = item.trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    result.push(text);
  }
  return result;
}

function GoalCreateDialog({
  open,
  t,
  chat,
  busy,
  options,
  onClose,
  onCreate,
}: {
  open: boolean;
  t: GoalsPageMessages;
  chat: ChatMessages;
  busy: boolean;
  options: GoalCreateOptions;
  onClose: () => void;
  onCreate: (draft: CreateGoalDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CreateGoalDraft>(() => emptyCreateDraft());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const attachmentTools = useComposerAttachments({ chat });

  useEffect(() => {
    if (!open) {
      setDraft(emptyCreateDraft());
      setAdvancedOpen(false);
      setLocalError(null);
      attachmentTools.clearAttachments();
    }
  }, [attachmentTools.clearAttachments, open]);

  useEffect(() => {
    if (!open || !options.defaultAgentId) return;
    setDraft((prev) => (prev.agentId ? prev : { ...prev, agentId: options.defaultAgentId }));
  }, [open, options.defaultAgentId]);

  const patch = (next: Partial<CreateGoalDraft>) => setDraft((prev) => ({ ...prev, ...next }));
  const agents: GatewayAgentRow[] = options.agents.length ? options.agents : [{
    id: options.defaultAgentId || 'main',
    workspace: '',
    profileDir: '',
    typedModels: { defaultRole: 'deep', preset: [], effective: [] },
    extends: [],
    isDefault: true,
    skills: { preset: [] },
    tools: { presetDenied: [], entryDisable: [], effectiveDisable: [] },
  } satisfies GatewayAgentRow];
  const selectedAgent = agents.find((agent) => agent.id === draft.agentId) ?? agents.find((agent) => agent.id === options.defaultAgentId) ?? agents[0];
  const selectedAgentId = draft.agentId || selectedAgent?.id || 'main';
  const agentModelRoles = [...(selectedAgent?.typedModels.effective ?? [])].sort((a, b) => {
    if (a.id === 'judge') return -1;
    if (b.id === 'judge') return 1;
    return a.id.localeCompare(b.id);
  });
  const modelOptions = options.models.filter((model, index, all) => all.findIndex((item) => item.id === model.id) === index);
  const patchDeadlineMode = (mode: CreateGoalDraft['deadlineMode']) => {
    patch({ deadlineMode: mode, deadline: nextDeadlineForMode(mode) });
  };
  const patchChecklist = (index: number, text: string) => {
    setDraft((prev) => ({
      ...prev,
      checklist: prev.checklist.map((item, i) => (i === index ? text : item)),
    }));
  };
  const removeChecklist = (index: number) => {
    setDraft((prev) => ({ ...prev, checklist: prev.checklist.filter((_, i) => i !== index) }));
  };

  const submit = async () => {
    setLocalError(null);
    if (!draft.title.trim()) {
      setLocalError(t.createDialog.titleRequired);
      return;
    }
    try {
      await onCreate({
        ...draft,
        attachments: attachmentTools.wireAttachmentsPayload(),
        checklist: normalizeChecklist(draft.checklist),
      });
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t.errors.create);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(92vh,46rem)] w-[min(100%-2rem,44rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold tracking-tight text-fg">{t.createDialog.title}</Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-sm text-fg-muted">{t.createDialog.description}</Dialog.Description>
            </div>
            <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={t.closeDetails} onClick={onClose}>
              <X className="size-5" aria-hidden />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-fg">{t.createDialog.goalTitle}</span>
                <input
                  value={draft.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder={t.newGoalPlaceholder}
                  className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  autoFocus
                />
              </label>

              <label className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">{t.createDialog.goalDescription}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 rounded-lg text-xs"
                    onClick={() => attachmentTools.fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-3.5" aria-hidden />
                    {t.createDialog.addAttachment}
                  </Button>
                </div>
                <textarea
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder={t.createDialog.descriptionPlaceholder}
                  rows={4}
                  className="resize-none rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
                <input
                  ref={attachmentTools.fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = '';
                    void attachmentTools.processFiles(files);
                  }}
                />
                <ComposerAttachmentChips
                  attachments={attachmentTools.attachments}
                  topPadded={false}
                  onRemove={attachmentTools.removeAttachment}
                />
              </label>

              <section className="rounded-2xl border border-edge-subtle bg-surface-base/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{t.createDialog.criteriaTitle}</h3>
                    <p className="mt-1 text-xs text-fg-muted">{t.createDialog.criteriaHint}</p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {options.checklistDecomposePolicy === 'supplement_existing'
                        ? t.createDialog.checklistPolicySupplementExisting
                        : t.createDialog.checklistPolicyEmptyOnly}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 rounded-lg text-xs"
                    onClick={() => patch({ checklist: aiChecklistDraft(draft, t) })}
                    disabled={!draft.title.trim() && !draft.description.trim()}
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    {t.createDialog.aiDraft}
                  </Button>
                </div>

                <div className="mt-3 grid gap-2">
                  {draft.checklist.map((item, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        value={item}
                        onChange={(e) => patchChecklist(index, e.target.value)}
                        placeholder={formatMessage(t.createDialog.criteriaPlaceholder, { index: index + 1 })}
                        className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="size-9 shrink-0 rounded-lg p-0"
                        aria-label={t.createDialog.removeCriteria}
                        onClick={() => removeChecklist(index)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 justify-start rounded-lg text-xs"
                    onClick={() => patch({ checklist: [...draft.checklist, ''] })}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {t.createDialog.addCriteria}
                  </Button>
                </div>
              </section>

              <section className="rounded-2xl border border-edge-subtle bg-surface-base/60">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <Settings2 className="size-4 text-fg-muted" aria-hidden />
                    {t.createDialog.advanced}
                  </span>
                  <ChevronDown className={cn('size-4 text-fg-muted transition-transform', advancedOpen && 'rotate-180')} aria-hidden />
                </button>
                {advancedOpen ? (
                  <div className="grid gap-3 border-t border-edge-subtle p-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 sm:col-span-2">
                      <span className="text-sm font-medium text-fg">{t.createDialog.agentId}</span>
                      <Select
                        value={selectedAgentId}
                        onChange={(e) => patch({ agentId: e.target.value })}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        {agents.map((agent) => (
                          <SelectOption key={agent.id} value={agent.id}>
                            {(agent.name?.trim() || agent.id) + (agent.isDefault ? ` · ${t.createDialog.defaultAgent}` : ` · ${agent.id}`)}
                          </SelectOption>
                        ))}
                      </Select>
                      {selectedAgent?.description ? (
                        <span className="line-clamp-2 text-xs text-fg-muted">{selectedAgent.description}</span>
                      ) : selectedAgent?.model?.primary ? (
                        <span className="truncate text-xs text-fg-muted">{formatMessage(t.createDialog.agentPrimaryModel, { model: selectedAgent.model.primary })}</span>
                      ) : null}
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-sm font-medium text-fg">{t.createDialog.priority}</span>
                      <Select
                        value={draft.priority}
                        onChange={(e) => patch({ priority: e.target.value as GoalItem['priority'] })}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        <SelectOption value="normal">{t.priorities.normal}</SelectOption>
                        <SelectOption value="high">{t.priorities.high}</SelectOption>
                        <SelectOption value="low">{t.priorities.low}</SelectOption>
                      </Select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-sm font-medium text-fg">{t.createDialog.deadline}</span>
                      <Select
                        value={draft.deadlineMode}
                        onChange={(e) => patchDeadlineMode(e.target.value as CreateGoalDraft['deadlineMode'])}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        <SelectOption value="none">{t.createDialog.deadlineNone}</SelectOption>
                        <SelectOption value="today">{t.createDialog.deadlineToday}</SelectOption>
                        <SelectOption value="tomorrow">{t.createDialog.deadlineTomorrow}</SelectOption>
                        <SelectOption value="friday">{t.createDialog.deadlineFriday}</SelectOption>
                        <SelectOption value="custom">{t.createDialog.deadlineCustom}</SelectOption>
                      </Select>
                    </label>
                    {draft.deadlineMode !== 'none' ? (
                      <label className="grid gap-1.5">
                        <span className="text-sm font-medium text-fg">{t.createDialog.deadlineAt}</span>
                        <input
                          type="datetime-local"
                          value={draft.deadline}
                          onChange={(e) => patch({ deadline: e.target.value, deadlineMode: 'custom' })}
                          className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        />
                      </label>
                    ) : null}
                    <label className="grid gap-1.5">
                      <span className="text-sm font-medium text-fg">{t.createDialog.maxTurns}</span>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={draft.maxTurns}
                        onChange={(e) => patch({ maxTurns: e.target.value })}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      />
                    </label>
                    <label className="grid gap-1.5 sm:col-span-2">
                      <span className="text-sm font-medium text-fg">{t.createDialog.judgeModel}</span>
                      <Select
                        value={draft.judgeModelRef}
                        onChange={(e) => patch({ judgeModelRef: e.target.value })}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        <SelectOption value="">{t.createDialog.judgeModelPlaceholder}</SelectOption>
                        {agentModelRoles.length ? (
                          <SelectGroup label={t.createDialog.agentModelRoles}>
                            {agentModelRoles.map((role) => (
                              <SelectOption key={`${role.id}:${role.model}`} value={role.model}>
                                {role.id === 'judge' ? t.createDialog.judgeRole : role.id} · {role.model}
                              </SelectOption>
                            ))}
                          </SelectGroup>
                        ) : null}
                        <SelectGroup label={t.createDialog.configuredModels}>
                          {modelOptions.map((model) => (
                            <SelectOption key={model.id} value={model.id}>
                              {model.name} · {model.id}
                            </SelectOption>
                          ))}
                        </SelectGroup>
                      </Select>
                    </label>
                  </div>
                ) : null}
              </section>

              {localError ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{localError}</p> : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-5 py-4">
            <Button type="button" variant="ghost" className="rounded-lg" onClick={onClose}>
              {t.createDialog.cancel}
            </Button>
            <Button type="button" variant="primary" className="rounded-lg" disabled={busy || !draft.title.trim()} onClick={() => void submit()}>
              <Plus className="size-4" aria-hidden />
              {t.createDialog.create}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
  const p = progress(goal);
  const primary = primaryAction(goal);
  const secondary = secondaryActions(goal);

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(90vh,48rem)] w-[min(100%-2rem,56rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold tracking-tight text-fg">{goal.title}</Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-xs text-fg-muted">
                {statusLabel(goal.status, t)} · {formatMessage(t.turns, { used: goal.turnsUsed, max: goal.maxTurns })}
              </Dialog.Description>
            </div>
            <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={t.closeDetails} onClick={onClose}>
              <X className="size-5" aria-hidden />
            </Button>
          </div>
          <section className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClass(goal.status))}>
                    {statusLabel(goal.status, t)}
                  </span>
                  <span className="text-xs text-fg-muted">{goal.agentId}</span>
                  <span className="text-xs text-fg-muted">{formatMessage(t.checklistProgress, { done: p.done, total: p.total })}</span>
                </div>
                {goal.description ? <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-fg-muted">{goal.description}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {primary ? (
                  <GoalActionButton
                    goalId={goal.id}
                    action={primary}
                    t={t}
                    busy={busy}
                    variant={primary === 'continue' ? 'primary' : 'secondary'}
                    onAction={onAction}
                  />
                ) : null}
                {secondary.map((action) => (
                  <GoalActionButton
                    key={action}
                    goalId={goal.id}
                    action={action}
                    t={t}
                    busy={busy}
                    variant={action === 'archive' ? 'ghost' : 'secondary'}
                    onAction={onAction}
                  />
                ))}
                <Button asChild type="button" variant="secondary" className="h-9 rounded-lg">
                  <Link to={`/goals/${encodeURIComponent(goal.id)}`}>
                    <ExternalLink className="size-4" aria-hidden />
                    {t.fullDetails}
                  </Link>
                </Button>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-edge-subtle bg-surface-base/60 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-accent-soft p-2 text-accent-fg">
                  <ListChecks className="size-4" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-fg">{goal.blockedReason ? t.currentBlocker : t.nextAction}</h3>
                  <p className={cn('mt-1 text-sm leading-6', goal.blockedReason ? 'text-amber-700 dark:text-amber-300' : 'text-fg-muted')}>
                    {goal.blockedReason || goal.nextAction || t.noNextAction}
                  </p>
                </div>
              </div>
            </div>

            {queueItem ? (
              <div className="mt-4 rounded-2xl border border-edge-subtle bg-surface-base/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-fg">{t.executionQueue}</h3>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', queueTone(queueItem.status))}>
                    {statusLabel(queueItem.status, t)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-fg-muted">
                  {formatMessage(t.attempt, { attempts: queueItem.attempts, max: queueItem.maxRetries + 1 })} · {formatDateTime(queueTime(queueItem), language)}
                </p>
                {queueItem.error ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{queueItem.error}</p> : null}
                {queueItem.userTurn?.text ? <p className="mt-2 text-sm text-fg-muted">{queueItem.userTurn.text}</p> : null}
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-edge-subtle bg-surface-base/60 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <ListChecks className="size-4 text-accent" aria-hidden />
                {t.checklist}
              </h3>
              {goal.checklist.length ? (
                <ul className="mt-3 grid gap-2 text-sm text-fg-muted">
                  {goal.checklist.map((item) => (
                    <li key={item.id} className="flex gap-2">
                      <span className="w-5 shrink-0 text-center">{checklistGlyph(item.status)}</span>
                      <span className="break-words">{item.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">{t.noChecklist}</p>
              )}
            </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GoalsPage() {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).goalsPage;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [queue, setQueue] = useState<GoalQueueItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createOptions, setCreateOptions] = useState<GoalCreateOptions>({
    defaultAgentId: '',
    agents: [],
    models: [],
    checklistDecomposePolicy: 'empty_only',
  });
  const [viewMode, setViewMode] = useState<GoalsViewMode>('focus');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [draggingGoalId, setDraggingGoalId] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<GoalBoardLaneId | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextGoals, nextQueue] = await Promise.all([listGoals(), fetchGoalQueue()]);
      setGoals(nextGoals);
      setQueue(nextQueue);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.load);
    } finally {
      setLoading(false);
    }
  }, [t.errors.load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function loadCreateOptions() {
      const [agentsResult, modelsResult, configResult] = await Promise.allSettled([
        fetchGatewayAgents(),
        fetchConfiguredModelsCached(),
        fetchGatewayConfigSwrResponse(),
      ]);
      if (cancelled) return;
      setCreateOptions((prev) => {
        const defaultAgentId = agentsResult.status === 'fulfilled' ? agentsResult.value.defaultId : prev.defaultAgentId;
        const agents = agentsResult.status === 'fulfilled' ? agentsResult.value.agents : prev.agents;
        const models = modelsResult.status === 'fulfilled' ? modelsResult.value : prev.models;
        const checklistDecomposePolicy = configResult.status === 'fulfilled'
          ? normalizeGoalsConfigFromConfig(configResult.value.payload?.config).checklistDecomposePolicy
          : prev.checklistDecomposePolicy;
        return {
          defaultAgentId,
          agents: agents.length ? agents : [{
            id: defaultAgentId || 'main',
            workspace: '',
            profileDir: '',
            typedModels: { defaultRole: 'deep', preset: [], effective: [] },
            extends: [],
            isDefault: true,
            skills: { preset: [] },
            tools: { presetDenied: [], entryDisable: [], effectiveDisable: [] },
          }],
          models,
          checklistDecomposePolicy,
        };
      });
    }
    void loadCreateOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      void fetchGoalQueue()
        .then(setQueue)
        .catch(() => {
          /* keep the last snapshot */
        });
    };
    window.addEventListener('goal-queue-updated', handler);
    return () => window.removeEventListener('goal-queue-updated', handler);
  }, []);

  const queueByGoal = useMemo(() => queueForGoals(queue), [queue]);
  const visibleGoals = useMemo(() => goals.filter((goal) => matchesSearch(goal, query)), [goals, query]);
  const focusGroups = useMemo(() => {
    const grouped = new Map<FocusSectionId, GoalItem[]>(FOCUS_SECTIONS.map((section) => [section, []]));
    for (const goal of visibleGoals) {
      const section = focusSectionForGoal(goal, queueByGoal.get(goal.id));
      if (section) grouped.get(section)?.push(goal);
    }
    for (const section of FOCUS_SECTIONS) {
      grouped.get(section)?.sort((a, b) => compareGoalsForFocus(a, b, queueByGoal));
    }
    return grouped;
  }, [queueByGoal, visibleGoals]);
  const lanes = useMemo(() => {
    const grouped = new Map<GoalBoardLaneId, GoalItem[]>(BOARD_LANES.map((lane) => [lane, []]));
    for (const goal of visibleGoals) {
      grouped.get(laneForGoal(goal))?.push(goal);
    }
    return grouped;
  }, [visibleGoals]);
  const selectedGoal = useMemo(() => goals.find((goal) => goal.id === selectedGoalId) ?? null, [goals, selectedGoalId]);

  const counts = useMemo(() => {
    const open = goals.filter((g) => g.status === 'active' || g.status === 'paused' || g.status === 'blocked' || g.status === 'needs_input').length;
    const attention = goals.filter((g) => g.status === 'blocked' || g.status === 'needs_input').length;
    const running = queue.filter((item) => item.status === 'running').length;
    const queued = queue.filter((item) => item.status === 'queued' || item.status === 'retry_waiting').length;
    const failed = queue.filter((item) => item.status === 'failed').length;
    const active = goals.filter((g) => g.status === 'active').length;
    return { open, attention, running, queued, failed, active };
  }, [goals, queue]);

  const queueSummary = useMemo(
    () => [
      { key: 'running', count: counts.running },
      { key: 'queued', count: counts.queued },
      { key: 'failed', count: counts.failed },
    ],
    [counts.failed, counts.queued, counts.running],
  );

  const runAction = async (goalId: string, action: GoalAction) => {
    setBusy(`${goalId}:${action}`);
    setError(null);
    try {
      if (action === 'continue') {
        const sessionKey = await continueGoal(goalId);
        if (sessionKey) {
          navigate(`/chat/${encodeURIComponent(sessionKey)}`);
          return;
        }
      } else {
        await postGoalAction(goalId, action);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.action);
    } finally {
      setBusy(null);
    }
  };

  const applyDrop = async (goalId: string, lane: GoalBoardLaneId) => {
    const goal = goals.find((item) => item.id === goalId);
    const action = goal ? dragAction(goal, lane) : null;
    setDropLane(null);
    setDraggingGoalId(null);
    if (!goal || !action) return;
    await runAction(goal.id, action);
  };

  const createFromDraft = useCallback(async (draft: CreateGoalDraft) => {
    const maxTurns = Number.parseInt(draft.maxTurns, 10);
    const deadlineAt = draft.deadline ? new Date(draft.deadline).getTime() : undefined;
    setBusy('create');
    setError(null);
    try {
      const goal = await createGoal({
        title: draft.title.trim(),
        contextMessage: {
          text: draft.description.trim(),
          attachments: draft.attachments.length ? draft.attachments : undefined,
        },
        priority: draft.priority,
        deadlineAt: Number.isFinite(deadlineAt) ? deadlineAt : undefined,
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
        agentId: draft.agentId.trim() || undefined,
        judgeModelRef: draft.judgeModelRef.trim() || undefined,
      });
      for (const item of normalizeChecklist(draft.checklist)) {
        await addGoalChecklistItem(goal.id, item);
      }
      await refresh();
      setSelectedGoalId(goal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.create);
      throw err;
    } finally {
      setBusy(null);
    }
  }, [refresh, t.errors.create]);

  const headerEnd = useMemo(
    () => (
      <>
        <label className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t.searchPlaceholder}
            autoComplete="off"
            placeholder={t.searchPlaceholder}
            className="h-9 w-36 rounded-lg border border-edge bg-surface-muted py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent sm:w-56 lg:w-72"
          />
        </label>
        <RefreshButton className="size-9 shrink-0 p-0" loading={loading} label={t.refresh} onClick={refresh} />
        <Button type="button" variant="primary" className="h-9 rounded-lg" disabled={busy === 'create'} onClick={() => setCreateDialogOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {t.create}
        </Button>
      </>
    ),
    [busy, loading, query, refresh, t.create, t.refresh, t.searchPlaceholder],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>
          <p className="truncate text-xs text-fg-muted">
            {formatMessage(t.summary, { open: counts.open, attention: counts.attention, shown: visibleGoals.length })}
          </p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, counts.attention, counts.open, headerEnd, setPageHeader, t.summary, t.title, visibleGoals.length]);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 px-4 py-5 sm:px-6 2xl:px-8">
        <section className="mx-auto w-full max-w-app-main rounded-lg border border-edge bg-surface-panel p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md border border-edge-subtle bg-surface-muted/50 px-3 py-2">
                <p className="text-[11px] font-medium text-fg-muted">{t.overview.attention}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{counts.attention + counts.failed}</p>
              </div>
              <div className="rounded-md border border-edge-subtle bg-surface-muted/50 px-3 py-2">
                <p className="text-[11px] font-medium text-fg-muted">{t.overview.running}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{counts.running}</p>
              </div>
              <div className="rounded-md border border-edge-subtle bg-surface-muted/50 px-3 py-2">
                <p className="text-[11px] font-medium text-fg-muted">{t.overview.queued}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{counts.queued}</p>
              </div>
              <div className="rounded-md border border-edge-subtle bg-surface-muted/50 px-3 py-2">
                <p className="text-[11px] font-medium text-fg-muted">{t.overview.active}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{counts.active}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="mr-1 flex items-center gap-2 text-sm font-medium text-fg">
                <Clock3 className="size-4 text-accent" aria-hidden />
                {t.executionQueue}
              </div>
              {queueSummary.map((item) => (
                <span key={item.key} className="rounded-full border border-edge bg-surface-muted px-2 py-0.5 text-xs text-fg-muted">
                  {formatMessage(t.queueSummary[item.key as keyof typeof t.queueSummary], { count: item.count })}
                </span>
              ))}
              <div className="ml-0 flex rounded-lg border border-edge bg-surface-muted p-0.5 lg:ml-2">
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                    viewMode === 'focus' ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg',
                  )}
                  onClick={() => setViewMode('focus')}
                >
                  <ListFilter className="size-3.5" aria-hidden />
                  {t.viewModes.focus}
                </button>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                    viewMode === 'board' ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg',
                  )}
                  onClick={() => setViewMode('board')}
                >
                  <LayoutGrid className="size-3.5" aria-hidden />
                  {t.viewModes.board}
                </button>
              </div>
            </div>
          </div>
        </section>

        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-fg-muted">{t.loading}</p> : null}

        {viewMode === 'focus' ? (
          <section className="min-h-0 flex-1 overflow-y-auto pb-3" aria-label={t.focusLabel}>
            <div className="mx-auto grid w-full max-w-app-main gap-4">
              {FOCUS_SECTIONS.map((section) => {
                const sectionGoals = focusGroups.get(section) ?? [];
                return (
                  <section key={section} className="rounded-lg border border-edge bg-surface-panel/60">
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-edge-subtle px-4 py-3">
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-fg">{t.focusSections[section].title}</h2>
                        <p className="mt-1 text-xs text-fg-muted">{t.focusSections[section].description}</p>
                      </div>
                      <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold tabular-nums text-fg-muted">
                        {sectionGoals.length}
                      </span>
                    </header>
                    <div className="grid gap-2 p-2.5">
                      {sectionGoals.map((goal) => (
                        <FocusGoalRow
                          key={goal.id}
                          goal={goal}
                          queueItem={queueByGoal.get(goal.id)}
                          t={t}
                          language={language}
                          busy={busy}
                          selected={goal.id === selectedGoalId}
                          onOpen={(next) => setSelectedGoalId(next.id)}
                          onAction={(id, action) => void runAction(id, action)}
                        />
                      ))}
                      {!loading && sectionGoals.length === 0 ? (
                        <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed border-edge bg-surface-panel/40 px-4 py-5 text-center text-xs text-fg-subtle">
                          {t.focusSections[section].empty}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="mx-auto min-h-0 w-full max-w-app-main flex-1 overflow-x-auto pb-3" aria-label={t.boardLabel}>
            <div className="flex h-full min-w-max snap-x snap-mandatory gap-3">
              {BOARD_LANES.map((lane) => {
                const laneGoals = lanes.get(lane) ?? [];
                return (
                  <section
                    key={lane}
                    className={cn(
                      'flex h-full w-80 shrink-0 snap-center flex-col overflow-hidden rounded-2xl border bg-surface-panel/40',
                      dropLane === lane ? 'border-accent ring-1 ring-accent/30' : 'border-edge',
                    )}
                    aria-label={t.lanes[lane].title}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDropLane(lane);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropLane(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const goalId = event.dataTransfer.getData(DRAG_TYPE) || draggingGoalId;
                      if (goalId) void applyDrop(goalId, lane);
                    }}
                  >
                    <header className="flex shrink-0 items-center justify-between gap-2 rounded-t-2xl border-b border-edge-subtle bg-surface-panel/90 px-3.5 py-3 backdrop-blur">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="size-2 rounded-full bg-accent" aria-hidden />
                        <h2 className="truncate text-sm font-semibold text-fg">{t.lanes[lane].title}</h2>
                      </div>
                      <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold tabular-nums text-fg-muted">
                        {laneGoals.length}
                      </span>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2.5">
                      {laneGoals.map((goal) => (
                        <GoalCard
                          key={goal.id}
                          goal={goal}
                          queueItem={queueByGoal.get(goal.id)}
                          t={t}
                          language={language}
                          selected={goal.id === selectedGoalId}
                          dragging={goal.id === draggingGoalId}
                          onOpen={(next) => setSelectedGoalId(next.id)}
                          onDragStart={(goalId, event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData(DRAG_TYPE, goalId);
                            setDraggingGoalId(goalId);
                          }}
                          onDragEnd={() => {
                            setDraggingGoalId(null);
                            setDropLane(null);
                          }}
                        />
                      ))}
                      {!loading && laneGoals.length === 0 ? (
                        <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-edge bg-surface-panel/40 px-4 py-6 text-center text-xs text-fg-subtle">
                          {t.lanes[lane].empty}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        )}
      </div>
      <GoalCreateDialog
        open={createDialogOpen}
        t={t}
        chat={messages(language).chat}
        busy={busy === 'create'}
        options={createOptions}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={createFromDraft}
      />
      <GoalDetailDialog
        goal={selectedGoal}
        queueItem={selectedGoal ? queueByGoal.get(selectedGoal.id) : undefined}
        t={t}
        language={language}
        busy={busy}
        onClose={() => setSelectedGoalId(null)}
        onAction={(id, action) => void runAction(id, action)}
      />
    </main>
  );
}
