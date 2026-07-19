import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Archive,
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  CirclePause,
  CirclePlay,
  Code2,
  FileText,
  ExternalLink,
  FilePlus2,
  GitBranch,
  Gauge,
  ListChecks,
  Plus,
  RefreshCw,
  ScrollText,
  Terminal,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AutomationSuggestionCard } from '@/features/automations/automation-suggestion-card';
import type { AutomationRun } from '@/features/automations/automation-api';
import { formatAutomationMessage } from '@/features/automations/automation-explanations';
import { ProductAutomationFeedback } from '@/features/automations/product-automation-feedback';
import { messages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import {
  cancelWorkflowRun,
  listGoalWorkflowRuns,
  listWorkflowDefinitions,
  retryWorkflowRun,
  startGoalWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunSummary,
  type WorkflowRunStatus,
} from '@/features/workflows/workflow-api';
import { Select, SelectOption } from '@/components/ui/popover-select';

type GoalStatus = 'active' | 'paused' | 'blocked' | 'needs_input' | 'done' | 'archived';
type ChecklistStatus = 'pending' | 'completed' | 'impossible';
type EvidenceKind = 'file' | 'diff' | 'command' | 'test' | 'link' | 'message' | 'artifact';
type EvidenceRequirementStatus = 'pending' | 'ai_verified' | 'approved' | 'rejected';
type GoalOutcomeMetric = {
  name: string;
  baselineValue: number;
  targetValue: number;
  currentValue?: number;
  unit?: string;
  direction: 'increase' | 'decrease';
  sourceUrl?: string;
  measuredAt?: number;
};

function contractLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function GoalDetailPageSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="mt-4 h-4 w-full max-w-3xl" />
        <Skeleton className="mt-2 h-4 w-2/3 max-w-2xl" />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 grid gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-md" />
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-4 h-24 rounded-md" />
          <Skeleton className="mt-3 h-24 rounded-md" />
        </section>
      </div>
    </div>
  );
}

type GoalDetail = {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;
  agentId: string;
  priority: 'low' | 'normal' | 'high';
  deadlineAt?: number;
  turnsUsed: number;
  maxTurns: number;
  activeSessionKey?: string;
  nextAction?: string;
  blockedReason?: string;
  judgeModelRef?: string;
  createdAt: number;
  updatedAt: number;
  contract?: {
    version: number;
    objective: string;
    scopeBoundary?: string;
    evidencePlan: string[];
    outcomeMetric?: GoalOutcomeMetric;
  };
  evidenceRequirements: Array<{
    id: string;
    text: string;
    status: EvidenceRequirementStatus;
    evidenceIds: string[];
    reviewReason?: string;
    reviewConfidence?: number;
    reviewedBy?: 'ai' | 'user' | 'system';
    reviewedAt?: number;
    requiresHumanApproval: boolean;
  }>;
  checklist: Array<{
    id: string;
    text: string;
    status: ChecklistStatus;
    addedBy: 'user' | 'judge';
    evidenceSummary?: string;
  }>;
};

type GoalRun = {
  id: string;
  status: string;
  verdict?: string;
  reason?: string;
  nextAction?: string;
  assistantPreview?: string;
  startedAt: number;
  finishedAt?: number;
};

type GoalEvidence = {
  id: string;
  kind: EvidenceKind;
  title: string;
  summary?: string;
  uri?: string;
  data?: unknown;
  requirementIds?: string[];
  createdAt: number;
};

type GoalActivityItem = {
  id: string;
  kind: 'queue' | 'goal_run' | 'workflow_run' | 'event' | 'evidence';
  status?: string;
  title: string;
  summary?: string;
  createdAt: number;
  link?: { type: 'chat' | 'workflow_run'; value: string };
  data?: unknown;
};

type GoalWorkflowSuggestion = {
  definitionId: string;
  name: string;
  title: string;
  description: string;
  score: number;
  reasons: string[];
  tags: string[];
  successRate?: number;
  lastRunStatus?: WorkflowRunStatus;
};

type TimelineFilter = 'all' | GoalActivityItem['kind'];
type GoalDetailMessages = ReturnType<typeof messages>['goalDetailPage'];

const fieldClass =
  'min-w-0 rounded-md border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent';

const evidenceKinds: EvidenceKind[] = ['message', 'link', 'file', 'diff', 'command', 'test', 'artifact'];

function evidenceIcon(kind: EvidenceKind) {
  if (kind === 'command' || kind === 'test') return Terminal;
  if (kind === 'diff') return Code2;
  if (kind === 'file' || kind === 'artifact') return FileText;
  if (kind === 'link') return ExternalLink;
  return ScrollText;
}

function evidenceData(item: GoalEvidence): Record<string, unknown> {
  return item.data && typeof item.data === 'object' && !Array.isArray(item.data)
    ? (item.data as Record<string, unknown>)
    : {};
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function EvidenceCard({ item, language, t }: { item: GoalEvidence; language: StoredLanguage; t: GoalDetailMessages }) {
  const Icon = evidenceIcon(item.kind);
  const data = evidenceData(item);
  const command = stringField(data, 'command');
  const exitCode = numberField(data, 'exitCode');
  const path = stringField(data, 'path') || item.uri;
  const outputBytes = numberField(data, 'outputBytes');
  const fuzzyMatchUsed = data.fuzzyMatchUsed === true;

  return (
    <li className="rounded-md bg-surface-muted/40 px-2.5 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-accent-fg" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="break-words font-medium text-fg">{item.title}</p>
            {path ? <p className="mt-1 break-all text-xs text-fg-muted">{path}</p> : null}
          </div>
        </div>
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">{evidenceKindLabel(item.kind, t)}</span>
      </div>
      {command ? (
        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-panel px-2 py-1.5 text-xs text-fg"><code>{command}</code></pre>
      ) : null}
      {item.summary ? (
        item.kind === 'diff' ? (
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-surface-panel px-2 py-1.5 text-xs text-fg-muted"><code>{item.summary}</code></pre>
        ) : (
          <p className="mt-2 whitespace-pre-wrap break-words text-xs text-fg-muted">{item.summary}</p>
        )
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <time>{formatDateTime(item.createdAt, language, t)}</time>
        {exitCode != null ? <span>{formatMessage(t.exitCode, { code: exitCode })}</span> : null}
        {outputBytes != null ? <span>{formatMessage(t.outputBytes, { bytes: outputBytes })}</span> : null}
        {fuzzyMatchUsed ? <span>{t.fuzzyMatch}</span> : null}
      </div>
    </li>
  );
}

function badgeClass(status: GoalStatus): string {
  if (status === 'active') return 'border-accent/40 bg-accent-soft text-accent-fg';
  if (status === 'done') return 'border-edge bg-surface-muted text-fg-muted';
  if (status === 'blocked' || status === 'needs_input') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-edge bg-surface-panel text-fg-muted';
}

function workflowStatusClass(status: WorkflowRunStatus): string {
  if (status === 'succeeded') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout') return 'border-destructive/40 bg-destructive/10 text-destructive';
  if (status === 'cancelled') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-accent/40 bg-accent-soft text-accent-fg';
}

function activityIcon(kind: GoalActivityItem['kind']) {
  if (kind === 'workflow_run') return GitBranch;
  if (kind === 'goal_run') return Bot;
  if (kind === 'queue') return CirclePlay;
  if (kind === 'evidence') return FileText;
  return Activity;
}

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);
}

function localeTag(language: StoredLanguage): string {
  return language === 'zh' ? 'zh-CN' : 'en-US';
}

function formatDateTime(value: number | undefined, language: StoredLanguage, t: GoalDetailMessages): string {
  if (!value) return t.notSet;
  return new Intl.DateTimeFormat(localeTag(language), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDate(value: number | undefined, language: StoredLanguage, t: GoalDetailMessages): string {
  if (!value) return t.noDeadline;
  return new Intl.DateTimeFormat(localeTag(language), {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function primaryActionLabel(status: GoalStatus, t: GoalDetailMessages): string {
  if (status === 'blocked' || status === 'needs_input') return t.primaryActions.resolveBlocker;
  if (status === 'paused') return t.primaryActions.resume;
  if (status === 'done') return t.primaryActions.completed;
  if (status === 'archived') return t.primaryActions.archived;
  return t.primaryActions.continue;
}

function checklistGlyph(status: ChecklistStatus): string {
  if (status === 'completed') return '✓';
  if (status === 'impossible') return '!';
  return '○';
}

function isTimelineFilter(value: string | null): value is TimelineFilter {
  return value === 'all' || value === 'queue' || value === 'goal_run' || value === 'workflow_run' || value === 'event' || value === 'evidence';
}

function statusLabel(status: GoalStatus | string | undefined, t: GoalDetailMessages): string {
  if (!status) return '';
  return t.statuses[status as GoalStatus] ?? status;
}

function priorityLabel(priority: GoalDetail['priority'], t: GoalDetailMessages): string {
  return t.priorities[priority] ?? priority;
}

function evidenceKindLabel(kind: EvidenceKind, t: GoalDetailMessages): string {
  return t.evidenceKinds[kind] ?? kind;
}

function outcomeMetricAchieved(metric: GoalOutcomeMetric | undefined): boolean {
  if (!metric || metric.currentValue == null) return false;
  return metric.direction === 'increase'
    ? metric.currentValue >= metric.targetValue
    : metric.currentValue <= metric.targetValue;
}

function finiteDraftNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function goalStatusSummary(
  goal: GoalDetail,
  latestRun: GoalRun | undefined,
  t: GoalDetailMessages,
): { title: string; body: string; tone: 'normal' | 'attention' | 'done'; needsReview: boolean } {
  const pendingEvidence = goal.evidenceRequirements.some((item) => item.status !== 'approved');
  const pendingOutcome = Boolean(goal.contract?.outcomeMetric && !outcomeMetricAchieved(goal.contract.outcomeMetric));
  const recordedDoneButUnverified = goal.status === 'done' && (
    pendingEvidence || pendingOutcome || latestRun?.verdict === 'continue'
  );
  if (recordedDoneButUnverified) {
    return {
      title: t.progressPanel.executionFinishedTitle,
      body: t.progressPanel.executionFinishedFallback,
      tone: 'attention',
      needsReview: true,
    };
  }
  if (goal.status === 'blocked') {
    return {
      title: t.progressPanel.blockedTitle,
      body: goal.blockedReason || t.progressPanel.blockedFallback,
      tone: 'attention',
      needsReview: false,
    };
  }
  if (goal.status === 'needs_input') {
    const completionReview = goal.blockedReason?.startsWith('Completion review required');
    return {
      title: completionReview ? t.progressPanel.executionFinishedTitle : t.progressPanel.needsInputTitle,
      body: completionReview
        ? t.progressPanel.executionFinishedFallback
        : goal.blockedReason || goal.nextAction || t.progressPanel.needsInputFallback,
      tone: 'attention',
      needsReview: Boolean(completionReview),
    };
  }
  if (goal.status === 'paused') {
    return {
      title: t.progressPanel.pausedTitle,
      body: goal.blockedReason || t.progressPanel.pausedFallback,
      tone: 'normal',
      needsReview: false,
    };
  }
  if (goal.status === 'done') {
    return {
      title: t.progressPanel.doneTitle,
      body: t.progressPanel.doneFallback,
      tone: 'done',
      needsReview: false,
    };
  }
  if (goal.status === 'archived') {
    return {
      title: t.progressPanel.archivedTitle,
      body: t.progressPanel.archivedFallback,
      tone: 'normal',
      needsReview: false,
    };
  }
  return {
    title: t.progressPanel.activeTitle,
    body: goal.nextAction || t.noNextAction,
    tone: 'normal',
    needsReview: false,
  };
}

function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

function GoalProgressPanel({
  goal,
  latestRun,
  done,
  total,
  evidence,
  language,
  t,
  busy,
  primaryActionDisabled,
  onContinue,
  onOpenChat,
  onPause,
  onConfigureOutcome,
  onReviewEvidence,
}: {
  goal: GoalDetail;
  latestRun?: GoalRun;
  done: number;
  total: number;
  evidence: GoalEvidence[];
  language: StoredLanguage;
  t: GoalDetailMessages;
  busy: string | null;
  primaryActionDisabled: boolean;
  onContinue: () => void;
  onOpenChat: () => void;
  onPause: () => void;
  onConfigureOutcome: () => void;
  onReviewEvidence: () => void;
}) {
  const summary = goalStatusSummary(goal, latestRun, t);
  const approvedEvidence = goal.evidenceRequirements.filter((item) => item.status === 'approved').length;
  const evidenceRequired = goal.evidenceRequirements.length;
  const missingEvidence = goal.evidenceRequirements.filter((item) => item.status !== 'approved').slice(0, 2);
  const checklistPercent = progressPercent(done, total);
  const metric = goal.contract?.outcomeMetric;
  const outcomeAchieved = outcomeMetricAchieved(metric);
  const StatusIcon = summary.tone === 'attention' ? AlertTriangle : summary.tone === 'done' ? CheckCircle2 : CirclePlay;

  return (
    <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
      <div className="grid gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full border px-2 py-0.5 text-xs', badgeClass(summary.needsReview ? 'needs_input' : goal.status))}>
              {summary.needsReview ? t.progressPanel.reviewPendingLabel : statusLabel(goal.status, t)}
            </span>
            <span className="text-xs text-fg-muted">{formatMessage(t.prioritySummary, { priority: priorityLabel(goal.priority, t) })}</span>
            <span className="text-xs text-fg-muted">{goal.deadlineAt ? formatDate(goal.deadlineAt, language, t) : t.noDeadline}</span>
          </div>
          <div className="mt-3 flex items-start gap-3">
            <div
              className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg',
                summary.tone === 'attention'
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : summary.tone === 'done'
                    ? 'bg-success-soft text-success'
                    : 'bg-accent-soft text-accent-fg',
              )}
            >
              <StatusIcon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-fg">{summary.title}</h2>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-muted">{summary.body}</p>
              {latestRun?.reason ? (
                <p className="mt-2 line-clamp-2 break-words text-xs text-fg-subtle">
                  {formatMessage(t.progressPanel.lastCheck, {
                    time: formatDateTime(latestRun.finishedAt ?? latestRun.startedAt, language, t),
                    reason: latestRun.reason,
                  })}
                </p>
              ) : null}
            </div>
          </div>
          {missingEvidence.length ? (
            <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{t.progressPanel.evidenceNeeded}</p>
              <ul className="mt-1 grid gap-1 text-xs text-amber-800 dark:text-amber-200">
                {missingEvidence.map((item) => (
                  <li key={item.id} className="break-words">- {item.text}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-edge-subtle bg-surface-panel/70 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
              <Gauge className="size-4" aria-hidden />
              {t.progressPanel.execution}
            </div>
            <p className="mt-2 text-lg font-semibold tabular-nums text-fg">
              {total ? formatMessage(t.checklistProgress, { done, total }) : t.notSet}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-accent" style={{ width: `${checklistPercent}%` }} />
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg border border-edge-subtle bg-surface-panel/70 p-3 text-left transition-colors hover:bg-surface-hover"
            onClick={onReviewEvidence}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-fg-muted">
              <span>{t.progressPanel.evidence}</span>
              <ChevronRight className="size-4" aria-hidden />
            </div>
            <p className="mt-2 text-lg font-semibold tabular-nums text-fg">
              {evidenceRequired
                ? formatMessage(t.evidenceRequirementProgress, { approved: approvedEvidence, total: evidenceRequired })
                : formatMessage(t.progressPanel.evidenceCount, { count: evidence.length })}
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              {missingEvidence.length ? t.progressPanel.reviewNeeded : t.progressPanel.reviewComplete}
            </p>
          </button>
          <button
            type="button"
            className={cn(
              'rounded-lg border p-3 text-left transition-colors hover:bg-surface-hover',
              metric && outcomeAchieved
                ? 'border-success/30 bg-success-soft/40'
                : 'border-edge-subtle bg-surface-panel/70',
            )}
            onClick={onConfigureOutcome}
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-fg-muted">
              <span className="flex items-center gap-2"><Target className="size-4" aria-hidden />{t.progressPanel.outcome}</span>
              <ChevronRight className="size-4" aria-hidden />
            </div>
            <p className="mt-2 truncate text-lg font-semibold tabular-nums text-fg">
              {metric
                ? formatMessage(t.progressPanel.outcomeSummary, {
                    baseline: metric.baselineValue,
                    current: metric.currentValue ?? t.progressPanel.currentMissing,
                    target: metric.targetValue,
                    unit: metric.unit ? ` ${metric.unit}` : '',
                  })
                : t.progressPanel.outcomeNotSet}
            </p>
            <p className="mt-1 truncate text-xs text-fg-muted">
              {metric ? metric.name : t.progressPanel.outcomeNotSetHint}
            </p>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-edge-subtle pt-4">
            <Button
              type="button"
              variant="primary"
              className="h-9 flex-1 rounded-lg"
              disabled={primaryActionDisabled}
              onClick={onContinue}
            >
              <CirclePlay className="size-4" aria-hidden />
              {summary.needsReview && goal.nextAction
                ? t.progressPanel.continueExecution
                : primaryActionLabel(goal.status, t)}
            </Button>
            {missingEvidence.length ? (
              <Button type="button" variant="secondary" className="h-9 rounded-lg" onClick={onReviewEvidence}>
                {t.progressPanel.reviewEvidenceAction}
              </Button>
            ) : null}
            {goal.activeSessionKey ? (
              <Button type="button" variant="secondary" className="h-9 rounded-lg px-2.5" aria-label={t.chat} onClick={onOpenChat}>
                <ExternalLink className="size-4" aria-hidden />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="h-9 rounded-lg px-2.5"
              aria-label={t.pause}
              disabled={busy != null || goal.status !== 'active'}
              onClick={onPause}
            >
              <CirclePause className="size-4" aria-hidden />
            </Button>
        </div>
      </div>
    </section>
  );
}

function safeGoalReturnPath(value: string | null): string {
  const path = value?.trim();
  if (!path || !path.startsWith('/projects/')) return '/goals';
  if (path.startsWith('//') || path.includes('://')) return '/goals';
  return path;
}

async function fetchGoal(goalId: string): Promise<GoalDetail> {
  const res = await fetchJson<{ ok: true; goal: GoalDetail }>(apiUrl(`/api/goals/${encodeURIComponent(goalId)}`));
  return res.goal;
}

async function fetchRuns(goalId: string): Promise<GoalRun[]> {
  const res = await fetchJson<{ ok: true; runs: GoalRun[] }>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/runs?limit=100`),
  );
  return res.runs;
}

async function fetchEvidence(goalId: string): Promise<GoalEvidence[]> {
  const res = await fetchJson<{ ok: true; evidence: GoalEvidence[] }>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/evidence?limit=100`),
  );
  return res.evidence;
}

async function fetchActivity(goalId: string): Promise<GoalActivityItem[]> {
  const res = await fetchJson<{ ok: true; activities: GoalActivityItem[] }>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/activity?limit=120`),
  );
  return res.activities;
}

async function fetchWorkflowSuggestions(goalId: string): Promise<GoalWorkflowSuggestion[]> {
  const res = await fetchJson<{ ok: true; suggestions: GoalWorkflowSuggestion[] }>(
    apiUrl(`/api/goals/${encodeURIComponent(goalId)}/workflow-suggestions`),
  );
  return res.suggestions;
}

export function GoalDetailPage() {
  const { goalId = '' } = useParams();
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).goalDetailPage;
  const automationSuggestions = messages(language).automations.suggestions;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const [searchParams, setSearchParams] = useSearchParams();
  const [goal, setGoal] = useState<GoalDetail | null>(null);
  const [runs, setRuns] = useState<GoalRun[]>([]);
  const [workflowDefinitions, setWorkflowDefinitions] = useState<WorkflowDefinition[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [workflowSuggestions, setWorkflowSuggestions] = useState<GoalWorkflowSuggestion[]>([]);
  const [evidence, setEvidence] = useState<GoalEvidence[]>([]);
  const [activity, setActivity] = useState<GoalActivityItem[]>([]);
  const [checklistText, setChecklistText] = useState('');
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>('message');
  const [evidenceTitle, setEvidenceTitle] = useState('');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [evidenceUri, setEvidenceUri] = useState('');
  const [evidenceRequirementDraft, setEvidenceRequirementDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [priorityDraft, setPriorityDraft] = useState<GoalDetail['priority']>('normal');
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [maxTurnsDraft, setMaxTurnsDraft] = useState('10');
  const [judgeModelDraft, setJudgeModelDraft] = useState('');
  const [nextActionDraft, setNextActionDraft] = useState('');
  const [blockedReasonDraft, setBlockedReasonDraft] = useState('');
  const [contractObjectiveDraft, setContractObjectiveDraft] = useState('');
  const [contractScopeBoundaryDraft, setContractScopeBoundaryDraft] = useState('');
  const [contractCriteriaDraft, setContractCriteriaDraft] = useState('');
  const [contractEvidencePlanDraft, setContractEvidencePlanDraft] = useState('');
  const [outcomeNameDraft, setOutcomeNameDraft] = useState('');
  const [outcomeBaselineDraft, setOutcomeBaselineDraft] = useState('');
  const [outcomeTargetDraft, setOutcomeTargetDraft] = useState('');
  const [outcomeCurrentDraft, setOutcomeCurrentDraft] = useState('');
  const [outcomeUnitDraft, setOutcomeUnitDraft] = useState('');
  const [outcomeSourceDraft, setOutcomeSourceDraft] = useState('');
  const [workflowDefinitionDraft, setWorkflowDefinitionDraft] = useState('');
  const [workflowGoalDraft, setWorkflowGoalDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backPath = useMemo(() => safeGoalReturnPath(searchParams.get('returnTo')), [searchParams]);

  const refresh = useCallback(async () => {
    if (!goalId) return;
    setLoading(true);
    setError(null);
    try {
      const [g, r, evi] = await Promise.all([
        fetchGoal(goalId),
        fetchRuns(goalId),
        fetchEvidence(goalId),
      ]);
      setGoal(g);
      setRuns(r);
      const [wfRuns, items] = await Promise.all([
        listGoalWorkflowRuns(goalId, 50),
        fetchActivity(goalId),
      ]);
      setWorkflowRuns(wfRuns);
      setActivity(items);
      setWorkflowSuggestions(await fetchWorkflowSuggestions(goalId));
      setEvidence(evi);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.load);
    } finally {
      setLoading(false);
    }
  }, [goalId, t.errors.load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void listWorkflowDefinitions()
      .then((definitions) => {
        if (cancelled) return;
        setWorkflowDefinitions(definitions);
        setWorkflowDefinitionDraft((current) => current || definitions[0]?.id || '');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t.errors.loadWorkflows);
      });
    return () => {
      cancelled = true;
    };
  }, [t.errors.loadWorkflows]);

  useEffect(() => {
    if (!goal) return;
    setTitleDraft(goal.title);
    setDescriptionDraft(goal.description ?? '');
    setPriorityDraft(goal.priority);
    setDeadlineDraft(goal.deadlineAt ? new Date(goal.deadlineAt).toISOString().slice(0, 10) : '');
    setMaxTurnsDraft(String(goal.maxTurns));
    setJudgeModelDraft(goal.judgeModelRef ?? '');
    setNextActionDraft(goal.nextAction ?? '');
    setBlockedReasonDraft(goal.blockedReason ?? '');
    setContractObjectiveDraft(goal.contract?.objective ?? goal.title);
    setContractScopeBoundaryDraft(goal.contract?.scopeBoundary ?? '');
    setContractCriteriaDraft(goal.checklist.map((item) => item.text).join('\n'));
    setContractEvidencePlanDraft(goal.contract?.evidencePlan.join('\n') ?? '');
    const metric = goal.contract?.outcomeMetric;
    setOutcomeNameDraft(metric?.name ?? '');
    setOutcomeBaselineDraft(metric ? String(metric.baselineValue) : '');
    setOutcomeTargetDraft(metric ? String(metric.targetValue) : '');
    setOutcomeCurrentDraft(metric?.currentValue != null ? String(metric.currentValue) : '');
    setOutcomeUnitDraft(metric?.unit ?? '');
    setOutcomeSourceDraft(metric?.sourceUrl ?? '');
    setEvidenceRequirementDraft((current) => goal.evidenceRequirements.some((item) => item.id === current)
      ? current
      : goal.evidenceRequirements[0]?.id ?? '');
    setWorkflowGoalDraft((current) => current || goal.nextAction || goal.title);
  }, [goal?.id, goal?.updatedAt]);

  const continueGoal = async () => {
    if (!goal) return;
    setBusy('continue');
    try {
      if (goal.status === 'done') {
        await fetchJson(apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/reopen`), {
          method: 'POST',
          body: JSON.stringify({}),
        });
      }
      const res = await fetchJson<{ ok: true; goal: GoalDetail | null; sessionKey?: string }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/continue`),
        { method: 'POST', body: JSON.stringify({}) },
      );
      if (res.sessionKey) {
        navigate(`/chat/${encodeURIComponent(res.sessionKey)}`);
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.continue);
    } finally {
      setBusy(null);
    }
  };

  const saveGoalDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goal) return;
    const title = titleDraft.trim();
    if (!title) return;
    setBusy('details:save');
    setError(null);
    try {
      const maxTurns = Number.parseInt(maxTurnsDraft, 10);
      const res = await fetchJson<{ ok: true; goal: GoalDetail }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}`),
        {
          method: 'PATCH',
          body: JSON.stringify({
            title,
            description: descriptionDraft.trim() || undefined,
            priority: priorityDraft,
            deadlineAt: deadlineDraft ? new Date(`${deadlineDraft}T23:59:59`).getTime() : undefined,
            maxTurns: Number.isFinite(maxTurns) ? maxTurns : goal.maxTurns,
            judgeModelRef: judgeModelDraft.trim() || undefined,
            nextAction: nextActionDraft.trim() || undefined,
            blockedReason: blockedReasonDraft.trim() || undefined,
          }),
        },
      );
      setGoal(res.goal);
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.save);
    } finally {
      setBusy(null);
    }
  };

  const saveGoalContract = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goal) return;
    const objective = contractObjectiveDraft.trim();
    if (!objective) return;
    setBusy('contract:save');
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; goal: GoalDetail }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/contract`),
        {
          method: 'PUT',
          body: JSON.stringify({
            objective,
            scopeBoundary: contractScopeBoundaryDraft.trim() || undefined,
            criteria: contractLines(contractCriteriaDraft),
            evidencePlan: contractLines(contractEvidencePlanDraft),
          }),
        },
      );
      setGoal(res.goal);
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.save);
    } finally {
      setBusy(null);
    }
  };

  const saveOutcomeMetric = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goal) return;
    const baselineValue = finiteDraftNumber(outcomeBaselineDraft);
    const targetValue = finiteDraftNumber(outcomeTargetDraft);
    const currentValue = finiteDraftNumber(outcomeCurrentDraft);
    if (!outcomeNameDraft.trim() || baselineValue == null || targetValue == null) return;
    setBusy('outcome:save');
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; goal: GoalDetail }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/contract`),
        {
          method: 'PUT',
          body: JSON.stringify({
            objective: goal.contract?.objective ?? goal.title,
            scopeBoundary: goal.contract?.scopeBoundary,
            criteria: goal.checklist.map((item) => item.text),
            evidencePlan: goal.contract?.evidencePlan ?? [],
            outcomeMetric: {
              name: outcomeNameDraft.trim(),
              baselineValue,
              targetValue,
              currentValue,
              unit: outcomeUnitDraft.trim() || undefined,
              sourceUrl: outcomeSourceDraft.trim() || undefined,
              measuredAt: currentValue == null ? undefined : Date.now(),
            },
          }),
        },
      );
      setGoal(res.goal);
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.save);
    } finally {
      setBusy(null);
    }
  };

  const clearOutcomeMetric = async () => {
    if (!goal) return;
    setBusy('outcome:clear');
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; goal: GoalDetail }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/contract`),
        {
          method: 'PUT',
          body: JSON.stringify({
            objective: goal.contract?.objective ?? goal.title,
            scopeBoundary: goal.contract?.scopeBoundary,
            criteria: goal.checklist.map((item) => item.text),
            evidencePlan: goal.contract?.evidencePlan ?? [],
            outcomeMetric: null,
          }),
        },
      );
      setGoal(res.goal);
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.save);
    } finally {
      setBusy(null);
    }
  };

  const postAction = async (action: 'pause' | 'archive') => {
    if (!goal) return;
    setBusy(action);
    try {
      await fetchJson(apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/${action}`), {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.action);
    } finally {
      setBusy(null);
    }
  };

  const runWorkflowForGoal = async () => {
    if (!goal || !workflowDefinitionDraft) return;
    setBusy('workflow:run');
    setError(null);
    try {
      const result = await startGoalWorkflowRun({
        goalId: goal.id,
        definitionId: workflowDefinitionDraft,
        goal: workflowGoalDraft.trim() || goal.nextAction || goal.title,
      });
      await refresh();
      navigate(`/chat/${encodeURIComponent(result.sessionKey)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.startWorkflow);
    } finally {
      setBusy(null);
    }
  };

  const reloadTimeline = async (id: string) => {
    try {
      const nextActivity = await fetchActivity(id);
      setActivity(nextActivity);
    } catch {
      // The primary mutation already succeeded; timeline refresh is non-critical.
    }
  };

  const reloadWorkflowRuns = async (id: string) => {
    try {
      const [nextWorkflowRuns, nextActivity, nextSuggestions] = await Promise.all([
        listGoalWorkflowRuns(id, 50),
        fetchActivity(id),
        fetchWorkflowSuggestions(id),
      ]);
      setWorkflowRuns(nextWorkflowRuns);
      setActivity(nextActivity);
      setWorkflowSuggestions(nextSuggestions);
    } catch {
      // The primary workflow action already succeeded.
    }
  };

  const cancelGoalWorkflowRun = async (run: WorkflowRunSummary) => {
    if (!goal) return;
    setBusy(`workflow:${run.id}:cancel`);
    setError(null);
    try {
      await cancelWorkflowRun(run.id, { ownerAgentId: goal.agentId });
      await reloadWorkflowRuns(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.cancelWorkflow);
    } finally {
      setBusy(null);
    }
  };

  const retryGoalWorkflowRun = async (run: WorkflowRunSummary) => {
    if (!goal) return;
    setBusy(`workflow:${run.id}:retry`);
    setError(null);
    try {
      const result = await retryWorkflowRun(run.id, { ownerAgentId: goal.agentId });
      await reloadWorkflowRuns(goal.id);
      navigate(`/chat/${encodeURIComponent(result.sessionKey)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.retryWorkflow);
    } finally {
      setBusy(null);
    }
  };

  const addChecklistItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goal) return;
    const text = checklistText.trim();
    if (!text) return;
    setBusy('checklist:add');
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; goal: GoalDetail }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/checklist`),
        { method: 'POST', body: JSON.stringify({ text }) },
      );
      setGoal(res.goal);
      setChecklistText('');
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.addChecklist);
    } finally {
      setBusy(null);
    }
  };

  const updateChecklistItem = async (itemId: string, status: ChecklistStatus) => {
    if (!goal) return;
    setBusy(`checklist:${itemId}:${status}`);
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; goal: GoalDetail }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/checklist/${encodeURIComponent(itemId)}`),
        { method: 'PATCH', body: JSON.stringify({ status }) },
      );
      setGoal(res.goal);
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.updateChecklist);
    } finally {
      setBusy(null);
    }
  };

  const deleteChecklistItem = async (itemId: string) => {
    if (!goal) return;
    setBusy(`checklist:${itemId}:delete`);
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; goal: GoalDetail }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/checklist/${encodeURIComponent(itemId)}`),
        { method: 'DELETE' },
      );
      setGoal(res.goal);
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.deleteChecklist);
    } finally {
      setBusy(null);
    }
  };

  const addEvidence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goal) return;
    const title = evidenceTitle.trim();
    if (!title) return;
    setBusy('evidence:add');
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; evidence: GoalEvidence }>(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/evidence`),
        {
          method: 'POST',
          body: JSON.stringify({
            kind: evidenceKind,
            title,
            summary: evidenceSummary.trim() || undefined,
            uri: evidenceUri.trim() || undefined,
            requirementId: evidenceRequirementDraft || undefined,
          }),
        },
      );
      setEvidence((items) => [res.evidence, ...items]);
      setGoal(await fetchGoal(goal.id));
      setEvidenceTitle('');
      setEvidenceSummary('');
      setEvidenceUri('');
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.addEvidence);
    } finally {
      setBusy(null);
    }
  };

  const reviewEvidenceRequirement = async (requirementId: string) => {
    if (!goal) return;
    setBusy(`requirement:${requirementId}:review`);
    setError(null);
    try {
      await fetchJson(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/evidence-requirements/${encodeURIComponent(requirementId)}/review`),
        { method: 'POST', body: JSON.stringify({ modelRef: goal.judgeModelRef }) },
      );
      setGoal(await fetchGoal(goal.id));
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.addEvidence);
    } finally {
      setBusy(null);
    }
  };

  const approveEvidenceRequirement = async (requirementId: string) => {
    if (!goal) return;
    setBusy(`requirement:${requirementId}:approve`);
    setError(null);
    try {
      await fetchJson(
        apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/evidence-requirements/${encodeURIComponent(requirementId)}/approve`),
        { method: 'POST', body: JSON.stringify({}) },
      );
      setGoal(await fetchGoal(goal.id));
      await reloadTimeline(goal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.addEvidence);
    } finally {
      setBusy(null);
    }
  };

  const saveAutomationInsight = async (run: AutomationRun) => {
    if (!goal || !run.summary) return;
    setError(null);
    const automationLabels = messages(language).automations;
    const res = await fetchJson<{ ok: true; evidence: GoalEvidence }>(
      apiUrl(`/api/goals/${encodeURIComponent(goal.id)}/evidence`),
      {
        method: 'POST',
        body: JSON.stringify({
          kind: 'message',
          title: formatAutomationMessage(automationLabels.feedback.insightEvidenceTitle, {
            name: run.automationName,
          }),
          summary: run.summary,
          data: {
            source: 'automation',
            automationRunId: run.id,
            automationId: run.automationId,
            automationName: run.automationName,
            sessionKey: run.sessionKey,
            workflowRunId: run.workflowRunId,
          },
        }),
      },
    );
    setEvidence((items) => [res.evidence, ...items]);
    await reloadTimeline(goal.id);
  };

  const done = goal?.checklist.filter((it) => it.status === 'completed' || it.status === 'impossible').length ?? 0;
  const total = goal?.checklist.length ?? 0;
  const savedAutomationInsightRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of evidence) {
      const data = evidenceData(item);
      const automationRunId = stringField(data, 'automationRunId');
      if (automationRunId) ids.add(automationRunId);
    }
    return ids;
  }, [evidence]);
  const displayEvidence = useMemo(() => {
    const seen = new Set<string>();
    return evidence.filter((item) => {
      if (item.title.trim().toLowerCase().startsWith('missing evidence:')) return false;
      const key = `${item.kind}\u0000${item.title.trim()}\u0000${item.summary?.trim() ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [evidence]);
  const failedWorkflowRuns = workflowRuns.filter((run) => run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled');
  const latestRun = runs[0];
  const timelineFilter = isTimelineFilter(searchParams.get('timeline')) ? searchParams.get('timeline') : 'all';
  const filteredActivity = timelineFilter === 'all' ? activity : activity.filter((item) => item.kind === timelineFilter);
  const activeWorkflowRuns = workflowRuns.filter((run) => run.status === 'queued' || run.status === 'running');
  const synthesizedSummary = goal ? goalStatusSummary(goal, latestRun, t) : null;
  const verifiedDone = goal?.status === 'done' && !synthesizedSummary?.needsReview;
  const primaryActionDisabled = busy != null || goal?.status === 'archived' || verifiedDone;

  const headerEnd = useMemo(() => {
    if (!goal) return null;
    return (
      <>
        {goal.activeSessionKey ? (
          <Button
            type="button"
            variant="secondary"
            className="h-9 gap-2 rounded-lg px-2.5 md:px-3"
            aria-label={t.chat}
            onClick={() => navigate(`/chat/${encodeURIComponent(goal.activeSessionKey!)}`)}
          >
            <ExternalLink className="size-4" aria-hidden />
            <span className="hidden md:inline">{t.chat}</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="h-9 gap-2 rounded-lg px-2.5 md:px-3"
          aria-label={t.archive}
          disabled={busy != null || goal.status === 'archived'}
          onClick={() => {
            if (window.confirm(t.archiveConfirm)) void postAction('archive');
          }}
        >
          <Archive className="size-4" aria-hidden />
          <span className="hidden md:inline">{t.archive}</span>
        </Button>
      </>
    );
  }, [busy, goal, navigate, t]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: (
        <Link to={backPath} className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={t.back}>
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      ),
      main: (
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-5 w-48 max-w-full" />
          ) : (
            <h1 className="truncate text-base font-semibold tracking-tight text-fg">{goal?.title ?? t.notFound}</h1>
          )}
          {goal ? (
            <p className="truncate text-xs text-fg-muted">
              {synthesizedSummary?.title ?? statusLabel(goal.status, t)} · {formatMessage(t.agent, { agentId: goal.agentId })}
            </p>
          ) : null}
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [backPath, clearPageHeader, goal, headerEnd, loading, setPageHeader, synthesizedSummary?.title, t]);

  const setTimelineFilter = (next: TimelineFilter) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') {
      params.delete('timeline');
    } else {
      params.set('timeline', next);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
      <div className="flex w-full flex-1 flex-col gap-4 px-3 py-5 sm:px-5 xl:px-6">
        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        {!loading && !goal ? <p className="text-sm text-fg-muted">{t.notFound}</p> : null}

        {loading ? (
          <GoalDetailPageSkeleton />
        ) : goal ? (
          <>
            <GoalProgressPanel
              goal={goal}
              latestRun={latestRun}
              done={done}
              total={total}
              evidence={evidence}
              language={language}
              t={t}
              busy={busy}
              primaryActionDisabled={primaryActionDisabled}
              onContinue={() => void continueGoal()}
              onOpenChat={() => goal.activeSessionKey && navigate(`/chat/${encodeURIComponent(goal.activeSessionKey)}`)}
              onPause={() => void postAction('pause')}
              onConfigureOutcome={() => document.getElementById('goal-outcome-metric')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              onReviewEvidence={() => document.getElementById('goal-verification')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />

            <section id="goal-outcome-metric" className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <Target className="size-4 text-accent" aria-hidden />
                    {t.outcomeMetric.title}
                  </h2>
                  <p className="mt-1 text-sm text-fg-muted">{t.outcomeMetric.hint}</p>
                </div>
                {goal.contract?.outcomeMetric ? (
                  <span className={cn(
                    'rounded-full border px-2 py-0.5 text-xs font-medium',
                    outcomeMetricAchieved(goal.contract.outcomeMetric)
                      ? 'border-success/30 bg-success-soft text-success'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
                  )}>
                    {outcomeMetricAchieved(goal.contract.outcomeMetric)
                      ? t.outcomeMetric.achieved
                      : t.outcomeMetric.notAchieved}
                  </span>
                ) : null}
              </div>
              <form className="mt-4 grid gap-3" onSubmit={saveOutcomeMetric}>
                <div className="grid gap-3 md:grid-cols-[minmax(12rem,1.4fr)_repeat(3,minmax(7rem,0.7fr))]">
                  <label className="grid gap-1 text-xs font-medium text-fg-muted">
                    {t.outcomeMetric.name}
                    <input value={outcomeNameDraft} onChange={(event) => setOutcomeNameDraft(event.target.value)} className={fieldClass} placeholder={t.outcomeMetric.namePlaceholder} />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-fg-muted">
                    {t.outcomeMetric.baseline}
                    <input value={outcomeBaselineDraft} onChange={(event) => setOutcomeBaselineDraft(event.target.value)} className={fieldClass} type="number" step="any" inputMode="decimal" />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-fg-muted">
                    {t.outcomeMetric.current}
                    <input value={outcomeCurrentDraft} onChange={(event) => setOutcomeCurrentDraft(event.target.value)} className={fieldClass} type="number" step="any" inputMode="decimal" />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-fg-muted">
                    {t.outcomeMetric.target}
                    <input value={outcomeTargetDraft} onChange={(event) => setOutcomeTargetDraft(event.target.value)} className={fieldClass} type="number" step="any" inputMode="decimal" />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)_auto] md:items-end">
                  <label className="grid gap-1 text-xs font-medium text-fg-muted">
                    {t.outcomeMetric.unit}
                    <input value={outcomeUnitDraft} onChange={(event) => setOutcomeUnitDraft(event.target.value)} className={fieldClass} placeholder={t.outcomeMetric.unitPlaceholder} />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-fg-muted">
                    {t.outcomeMetric.source}
                    <input value={outcomeSourceDraft} onChange={(event) => setOutcomeSourceDraft(event.target.value)} className={fieldClass} placeholder={t.outcomeMetric.sourcePlaceholder} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {goal.contract?.outcomeMetric ? (
                      <Button type="button" variant="ghost" className="h-9" disabled={busy != null} onClick={() => void clearOutcomeMetric()}>
                        {t.outcomeMetric.clear}
                      </Button>
                    ) : null}
                    <Button
                      type="submit"
                      variant="secondary"
                      className="h-9"
                      disabled={busy != null || !outcomeNameDraft.trim() || finiteDraftNumber(outcomeBaselineDraft) == null || finiteDraftNumber(outcomeTargetDraft) == null}
                    >
                      {t.outcomeMetric.save}
                    </Button>
                  </div>
                </div>
              </form>
            </section>

            <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
              <h2 className="text-sm font-semibold text-fg">{t.goalBrief}</h2>
              {goal.description ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-fg-muted">{goal.description}</p> : null}
              {goal.contract ? (
                <div className="mt-3 rounded-md border border-edge-subtle bg-surface-muted/40 px-3 py-3">
                  <p className="text-xs font-medium text-fg-muted">{t.goalContract}</p>
                  <p className="mt-1 break-words text-sm text-fg">{goal.contract.objective}</p>
                  {goal.contract.scopeBoundary ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-fg-muted">{t.scopeBoundary}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-muted">{goal.contract.scopeBoundary}</p>
                    </div>
                  ) : null}
                  {goal.contract.evidencePlan.length ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-fg-muted">{t.completionEvidence}</p>
                      <ul className="mt-1 grid gap-1 text-sm text-fg-muted">
                        {goal.contract.evidencePlan.map((item) => <li key={item}>• {item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  <details className="mt-3 rounded-md bg-surface-base/70 px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-fg">{t.editContract}</summary>
                    <form className="mt-3 grid gap-3" onSubmit={saveGoalContract}>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.contractObjective}
                        <textarea
                          value={contractObjectiveDraft}
                          onChange={(event) => setContractObjectiveDraft(event.target.value)}
                          name="contractObjective"
                          autoComplete="off"
                          className={cn(fieldClass, 'resize-y')}
                          rows={2}
                          placeholder={t.contractObjectivePlaceholder}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.scopeBoundary}
                        <textarea
                          value={contractScopeBoundaryDraft}
                          onChange={(event) => setContractScopeBoundaryDraft(event.target.value)}
                          name="contractScopeBoundary"
                          autoComplete="off"
                          className={cn(fieldClass, 'resize-y')}
                          rows={2}
                          placeholder={t.scopeBoundaryPlaceholder}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.acceptanceCriteria}
                        <textarea
                          value={contractCriteriaDraft}
                          onChange={(event) => setContractCriteriaDraft(event.target.value)}
                          name="contractCriteria"
                          autoComplete="off"
                          className={cn(fieldClass, 'resize-y')}
                          rows={3}
                          placeholder={t.contractLinesHint}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.completionEvidence}
                        <textarea
                          value={contractEvidencePlanDraft}
                          onChange={(event) => setContractEvidencePlanDraft(event.target.value)}
                          name="contractEvidencePlan"
                          autoComplete="off"
                          className={cn(fieldClass, 'resize-y')}
                          rows={3}
                          placeholder={t.contractLinesHint}
                        />
                      </label>
                      <Button type="submit" variant="secondary" className="h-9 w-fit" disabled={busy != null || !contractObjectiveDraft.trim()}>
                        {t.saveContract}
                      </Button>
                    </form>
                  </details>
                </div>
              ) : null}
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="grid min-w-0 gap-4">
                <section id="goal-verification" className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                        <ListChecks className="size-4 text-accent" aria-hidden />
                        {t.acceptance}
                      </h2>
                      <p className="mt-1 text-sm text-fg-muted">{t.acceptanceHint}</p>
                    </div>
                    <span className="text-xs text-fg-muted">{done}/{total}</span>
                  </div>
                  {latestRun ? (
                    <div className="mt-3 rounded-md bg-surface-muted/40 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                        <span>{formatMessage(t.latestJudgement, { status: statusLabel(latestRun.verdict ?? latestRun.status, t) })}</span>
                        <time>{formatDateTime(latestRun.finishedAt ?? latestRun.startedAt, language, t)}</time>
                      </div>
                      {latestRun.reason ? <p className="mt-1 break-words text-sm text-fg">{latestRun.reason}</p> : null}
                      {latestRun.nextAction ? <p className="mt-1 break-words text-xs text-fg-muted">{formatMessage(t.latestNext, { next: latestRun.nextAction })}</p> : null}
                    </div>
                  ) : null}
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <ListChecks className="size-4 text-accent" aria-hidden />
                    {t.checklist}
                  </h2>
                  <span className="text-xs text-fg-muted">{done}/{total}</span>
                </div>
                <form className="mb-3 flex flex-col gap-2 sm:flex-row" onSubmit={addChecklistItem}>
                  <input
                    value={checklistText}
                    onChange={(e) => setChecklistText(e.target.value)}
                    name="checklistText"
                    aria-label={t.addAcceptancePlaceholder}
                    autoComplete="off"
                    placeholder={t.addAcceptancePlaceholder}
                    className={cn(fieldClass, 'flex-1')}
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    className="h-9 gap-2"
                    disabled={busy != null || !checklistText.trim()}
                  >
                    <Plus className="size-4" aria-hidden />
                    {t.add}
                  </Button>
                </form>
                {goal.checklist.length ? (
                  <ul className="space-y-2 text-sm">
                    {goal.checklist.map((item) => (
                      <li key={item.id} className="rounded-md bg-surface-muted/40 px-2.5 py-2">
                        <div className="flex flex-wrap items-start gap-2">
                          <span className="mt-1 w-5 shrink-0 text-center text-fg-muted">{checklistGlyph(item.status)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-fg">{item.text}</p>
                            {item.evidenceSummary ? <p className="mt-1 text-xs text-fg-muted">{item.evidenceSummary}</p> : null}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              className="size-8 p-0"
                              title={t.markPending}
                              aria-label={t.markPending}
                              disabled={busy != null || item.status === 'pending'}
                              onClick={() => void updateChecklistItem(item.id, 'pending')}
                            >
                              <Circle className="size-4" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="size-8 p-0"
                              title={t.markCompleted}
                              aria-label={t.markCompleted}
                              disabled={busy != null || item.status === 'completed'}
                              onClick={() => void updateChecklistItem(item.id, 'completed')}
                            >
                              <CheckCircle2 className="size-4" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="size-8 p-0"
                              title={t.markImpossible}
                              aria-label={t.markImpossible}
                              disabled={busy != null || item.status === 'impossible'}
                              onClick={() => void updateChecklistItem(item.id, 'impossible')}
                            >
                              <XCircle className="size-4" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="size-8 p-0 text-destructive hover:text-destructive"
                              title={t.deleteChecklistItem}
                              aria-label={t.deleteChecklistItem}
                              disabled={busy != null}
                              onClick={() => void deleteChecklistItem(item.id)}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-fg-muted">{t.noChecklist}</p>
                )}
                  <div className="mt-4 border-t border-edge pt-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                      <FilePlus2 className="size-4 text-accent" aria-hidden />
                      {t.evidence}
                    </h3>
                    {goal.evidenceRequirements.length ? (
                      <div className="mb-4 grid gap-2 rounded-md border border-edge-subtle bg-surface-muted/40 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-fg-muted">{t.evidenceRequirements}</p>
                          <span className="text-xs text-fg-muted">
                            {formatMessage(t.evidenceRequirementProgress, {
                              approved: goal.evidenceRequirements.filter((item) => item.status === 'approved').length,
                              total: goal.evidenceRequirements.length,
                            })}
                          </span>
                        </div>
                        {goal.evidenceRequirements.map((requirement) => (
                          <div key={requirement.id} className="rounded-md bg-surface-base px-2.5 py-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="break-words text-sm text-fg">{requirement.text}</p>
                                <p className="mt-1 text-xs text-fg-muted">
                                  {formatMessage(t.linkedEvidenceCount, { count: requirement.evidenceIds.length })} · {t.evidenceRequirementStatuses[requirement.status]}
                                </p>
                                {requirement.reviewReason ? <p className="mt-1 break-words text-xs text-fg-muted">{requirement.reviewReason}</p> : null}
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-1.5">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  disabled={busy != null || requirement.evidenceIds.length === 0}
                                  onClick={() => void reviewEvidenceRequirement(requirement.id)}
                                >
                                  {t.reviewEvidence}
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="h-7 text-xs"
                                  disabled={busy != null || requirement.evidenceIds.length === 0 || requirement.status === 'approved'}
                                  onClick={() => void approveEvidenceRequirement(requirement.id)}
                                >
                                  {t.approveEvidence}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <form className="mb-3 grid gap-2" onSubmit={addEvidence}>
                      <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                        <label className="grid gap-1 text-xs font-medium text-fg-muted">
                          {t.kind}
                          <Select
                            value={evidenceKind}
                            onChange={(e) => setEvidenceKind(e.target.value as EvidenceKind)}
                            className={fieldClass}
                            name="evidenceKind"
                          >
                            {evidenceKinds.map((kind) => (
                              <SelectOption key={kind} value={kind}>
                                {evidenceKindLabel(kind, t)}
                              </SelectOption>
                            ))}
                          </Select>
                        </label>
                        <label className="grid gap-1 text-xs font-medium text-fg-muted">
                          {t.title}
                          <input
                            value={evidenceTitle}
                            onChange={(e) => setEvidenceTitle(e.target.value)}
                            name="evidenceTitle"
                            autoComplete="off"
                            placeholder={t.evidenceTitlePlaceholder}
                            className={fieldClass}
                          />
                        </label>
                      </div>
                      {goal.evidenceRequirements.length ? (
                        <label className="grid gap-1 text-xs font-medium text-fg-muted">
                          {t.provesRequirement}
                          <Select
                            value={evidenceRequirementDraft}
                            onChange={(event) => setEvidenceRequirementDraft(event.target.value)}
                            name="evidenceRequirement"
                            className={fieldClass}
                          >
                            {goal.evidenceRequirements.map((requirement) => (
                              <SelectOption key={requirement.id} value={requirement.id}>{requirement.text}</SelectOption>
                            ))}
                          </Select>
                        </label>
                      ) : null}
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.uriOrPath}
                        <input
                          value={evidenceUri}
                          onChange={(e) => setEvidenceUri(e.target.value)}
                          name="evidenceUri"
                          autoComplete="off"
                          placeholder={t.uriOrPathPlaceholder}
                          className={fieldClass}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.summary}
                        <textarea
                          value={evidenceSummary}
                          onChange={(e) => setEvidenceSummary(e.target.value)}
                          name="evidenceSummary"
                          autoComplete="off"
                          placeholder={t.summaryPlaceholder}
                          rows={3}
                          className={cn(fieldClass, 'resize-y')}
                        />
                      </label>
                      <Button
                        type="submit"
                        variant="secondary"
                        className="h-9 w-fit gap-2"
                        disabled={busy != null || !evidenceTitle.trim()}
                      >
                        <Plus className="size-4" aria-hidden />
                        {t.addEvidence}
                      </Button>
                    </form>
                    {displayEvidence.length ? (
                      <ul className="space-y-2 text-sm">
                        {displayEvidence.slice(0, 6).map((item) => <EvidenceCard key={item.id} item={item} language={language} t={t} />)}
                      </ul>
                    ) : (
                      <p className="text-sm text-fg-muted">{t.noEvidence}</p>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                        <Activity className="size-4 text-accent" aria-hidden />
                        {t.timeline}
                      </h2>
                      <p className="mt-1 text-sm text-fg-muted">{t.timelineHint}</p>
                    </div>
                    <Button type="button" variant="ghost" className="h-8 gap-1.5" onClick={() => void refresh()}>
                      <RefreshCw className="size-3.5" aria-hidden />
                      {t.refresh}
                    </Button>
                  </div>
                  {runs.length ? (
                    <ol className="mt-4 grid gap-2">
                      {runs.slice(0, 6).map((run, index) => (
                        <li key={run.id}>
                          <details
                            open={index === 0 && run.verdict !== 'done'}
                            className="group rounded-lg border border-edge-subtle bg-surface-muted/40 px-3 py-2"
                          >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:hidden">
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-fg">
                                  {formatMessage(t.executionProgress.runTitle, { number: runs.length - index })}
                                </span>
                                <time className="mt-0.5 block text-xs text-fg-muted">
                                  {formatDateTime(run.finishedAt ?? run.startedAt, language, t)}
                                </time>
                              </span>
                              <span className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
                                {statusLabel(run.verdict ?? run.status, t)}
                                <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
                              </span>
                            </summary>
                            <div className="mt-3 border-t border-edge-subtle pt-3">
                              {run.reason ? <p className="text-sm text-fg">{run.reason}</p> : null}
                              {run.assistantPreview ? <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-xs text-fg-muted">{run.assistantPreview}</p> : null}
                              {run.nextAction ? (
                                <div className="mt-3 rounded-md bg-surface-base px-3 py-2">
                                  <p className="text-xs font-medium text-fg-muted">{t.nextAction}</p>
                                  <p className="mt-1 text-sm text-fg">{run.nextAction}</p>
                                </div>
                              ) : null}
                            </div>
                          </details>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="mt-4 text-sm text-fg-muted">{t.executionProgress.noRuns}</p>}

                  <details className="mt-4 border-t border-edge-subtle pt-3">
                    <summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">
                      {formatMessage(t.executionProgress.systemActivity, { count: activity.length })}
                    </summary>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(['all', 'goal_run', 'workflow_run', 'evidence', 'queue', 'event'] as TimelineFilter[]).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        className={cn(
                          'rounded-md border px-2.5 py-1 text-xs font-medium',
                          timelineFilter === filter
                            ? 'border-accent bg-accent-soft text-accent-fg'
                            : 'border-edge bg-surface-panel text-fg-muted hover:bg-surface-hover hover:text-fg',
                        )}
                        onClick={() => setTimelineFilter(filter)}
                      >
                        {t.timelineFilters[filter]}
                      </button>
                    ))}
                  </div>
                  {filteredActivity.length ? (
                    <ul className="mt-3 space-y-2 text-sm">
                      {filteredActivity.map((item) => {
                      const Icon = activityIcon(item.kind);
                      return (
                        <li key={item.id} className="rounded-md bg-surface-muted/50 px-2.5 py-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-start gap-2">
                              <Icon className="mt-0.5 size-4 shrink-0 text-accent-fg" aria-hidden />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                                  <span>{t.timelineFilters[item.kind]}</span>
                                  {item.status ? <span>{statusLabel(item.status, t)}</span> : null}
                                </div>
                                <p className="mt-1 break-words font-medium text-fg">{item.title}</p>
                                {item.summary ? <p className="mt-1 line-clamp-3 break-words text-xs text-fg-muted">{item.summary}</p> : null}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-fg-muted">
                              <time>{formatDateTime(item.createdAt, language, t)}</time>
                              {item.link?.type === 'chat' ? (
                                <Button type="button" variant="ghost" className="h-7 gap-1.5" onClick={() => navigate(`/chat/${encodeURIComponent(item.link!.value)}`)}>
                                  <ExternalLink className="size-3.5" aria-hidden />
                                  {t.chat}
                                </Button>
                              ) : null}
                              {item.link?.type === 'workflow_run' ? (
                                <Button type="button" variant="ghost" className="h-7 gap-1.5" onClick={() => navigate(`/workflows?run=${encodeURIComponent(item.link!.value)}`)}>
                                  <ExternalLink className="size-3.5" aria-hidden />
                                  {t.run}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                    <p className="mt-3 text-sm text-fg-muted">{t.noTimeline}</p>
                )}
                  </details>
                </section>
              </div>

              <aside className="grid h-fit gap-4">
                <section className="rounded-lg border border-accent/25 bg-accent-soft/30 p-4">
                  <p className="text-xs font-medium text-accent-fg">{t.actionRail.nextTitle}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm font-medium text-fg">
                    {verifiedDone ? t.progressPanel.doneFallback : goal.nextAction || t.noNextAction}
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    className="mt-3 h-9 w-full gap-2"
                    disabled={busy != null || goal.status === 'archived'}
                    onClick={() => {
                      if (verifiedDone) {
                        if (window.confirm(t.archiveConfirm)) void postAction('archive');
                        return;
                      }
                      void continueGoal();
                    }}
                  >
                    {verifiedDone ? <Archive className="size-4" aria-hidden /> : <CirclePlay className="size-4" aria-hidden />}
                    {verifiedDone ? t.archive : t.actionRail.continueAction}
                  </Button>
                </section>

                {(goal.evidenceRequirements.some((item) => item.status !== 'approved') ||
                  Boolean(goal.contract?.outcomeMetric && !outcomeMetricAchieved(goal.contract.outcomeMetric)) ||
                  latestRun?.verdict === 'continue') ? (
                  <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                    <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">{t.actionRail.needsYou}</h2>
                    <ul className="mt-3 grid gap-2 text-sm text-amber-900 dark:text-amber-100">
                      {goal.contract?.outcomeMetric && !outcomeMetricAchieved(goal.contract.outcomeMetric)
                        ? <li>• {t.outcomeMetric.notAchieved}</li>
                        : null}
                      {goal.evidenceRequirements.some((item) => item.status !== 'approved')
                        ? <li>• {formatMessage(t.actionRail.reviewEvidenceCount, { count: goal.evidenceRequirements.filter((item) => item.status !== 'approved').length })}</li>
                        : null}
                      {latestRun?.verdict === 'continue' ? <li>• {t.actionRail.latestCheckContinue}</li> : null}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {goal.contract?.outcomeMetric && !outcomeMetricAchieved(goal.contract.outcomeMetric) ? (
                        <Button type="button" variant="secondary" className="h-8" onClick={() => document.getElementById('goal-outcome-metric')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                          {t.actionRail.setOutcome}
                        </Button>
                      ) : null}
                      {goal.evidenceRequirements.some((item) => item.status !== 'approved') ? (
                        <Button type="button" variant="secondary" className="h-8" onClick={() => document.getElementById('goal-verification')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                          {t.actionRail.reviewEvidence}
                        </Button>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                <details className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
                  <summary className="cursor-pointer text-sm font-semibold text-fg">{t.actionRail.automation}</summary>
                  <div className="mt-3 grid gap-3">
                    <ProductAutomationFeedback
                      eventType="goal.status_changed"
                      source="goals"
                      payloadKey="goalId"
                      payloadValue={goal.id}
                      onSaveInsight={saveAutomationInsight}
                      isInsightSaved={(run) => savedAutomationInsightRunIds.has(run.id)}
                    />
                    <ProductAutomationFeedback
                      eventType="goal.created"
                      source="goals"
                      payloadKey="goalId"
                      payloadValue={goal.id}
                      onSaveInsight={saveAutomationInsight}
                      isInsightSaved={(run) => savedAutomationInsightRunIds.has(run.id)}
                    />
                    {goal.status === 'blocked' || goal.blockedReason ? (
                      <AutomationSuggestionCard
                        title={automationSuggestions.goalBlockedTitle}
                        description={automationSuggestions.goalBlockedDescription}
                        prompt={formatMessage(automationSuggestions.goalBlockedPrompt, { title: goal.title })}
                        coverage={{
                          eventType: 'goal.status_changed',
                          source: 'goals',
                          eventPayload: { goalId: goal.id, status: 'blocked' },
                        }}
                      />
                    ) : null}
                  </div>
                </details>
                <details className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
                  <summary className="cursor-pointer text-sm font-semibold text-fg">{t.goalSettings}</summary>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-fg-muted">{t.deadline}</dt>
                      <dd className="text-right text-fg">{formatDate(goal.deadlineAt, language, t)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-fg-muted">{t.judgeModel}</dt>
                      <dd className="min-w-0 truncate text-right text-fg">{goal.judgeModelRef || t.default}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-fg-muted">{t.created}</dt>
                      <dd className="text-right text-fg">{formatDate(goal.createdAt, language, t)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-fg-muted">{t.updated}</dt>
                      <dd className="text-right text-fg">{formatDateTime(goal.updatedAt, language, t)}</dd>
                    </div>
                  </dl>
                  <details className="mt-4 rounded-md bg-surface-muted/40 px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-fg">{t.editDetails}</summary>
                    <form className="mt-3 grid gap-3" onSubmit={saveGoalDetails}>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.title}
                        <input
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          name="goalTitle"
                          autoComplete="off"
                          className={fieldClass}
                          placeholder={`${t.title}…`}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.description}
                        <textarea
                          value={descriptionDraft}
                          onChange={(e) => setDescriptionDraft(e.target.value)}
                          name="goalDescription"
                          autoComplete="off"
                          className={cn(fieldClass, 'resize-y')}
                          rows={3}
                          placeholder={`${t.description}…`}
                        />
                      </label>
                      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                        <label className="grid gap-1 text-xs font-medium text-fg-muted">
                          {t.priority}
                          <Select
                            value={priorityDraft}
                            onChange={(e) => setPriorityDraft(e.target.value as GoalDetail['priority'])}
                            name="goalPriority"
                            className={fieldClass}
                          >
                            <SelectOption value="low">{t.priorities.low}</SelectOption>
                            <SelectOption value="normal">{t.priorities.normal}</SelectOption>
                            <SelectOption value="high">{t.priorities.high}</SelectOption>
                          </Select>
                        </label>
                        <label className="grid gap-1 text-xs font-medium text-fg-muted">
                          {t.deadline}
                          <input
                            value={deadlineDraft}
                            onChange={(e) => setDeadlineDraft(e.target.value)}
                            name="goalDeadline"
                            className={fieldClass}
                            type="date"
                          />
                        </label>
                        <label className="grid gap-1 text-xs font-medium text-fg-muted">
                          {t.maxTurns}
                          <input
                            value={maxTurnsDraft}
                            onChange={(e) => setMaxTurnsDraft(e.target.value)}
                            name="goalMaxTurns"
                            className={fieldClass}
                            type="number"
                            min={1}
                            max={500}
                            inputMode="numeric"
                            placeholder={`${t.maxTurns}…`}
                          />
                        </label>
                      </div>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.judgeModel}
                        <input
                          value={judgeModelDraft}
                          onChange={(e) => setJudgeModelDraft(e.target.value)}
                          name="goalJudgeModel"
                          autoComplete="off"
                          className={fieldClass}
                          placeholder={`${t.judgeModel}…`}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.nextAction}
                        <textarea
                          value={nextActionDraft}
                          onChange={(e) => setNextActionDraft(e.target.value)}
                          name="goalNextAction"
                          autoComplete="off"
                          className={cn(fieldClass, 'resize-y')}
                          rows={2}
                          placeholder={`${t.nextAction}…`}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-fg-muted">
                        {t.blockedReason}
                        <textarea
                          value={blockedReasonDraft}
                          onChange={(e) => setBlockedReasonDraft(e.target.value)}
                          name="goalBlockedReason"
                          autoComplete="off"
                          className={cn(fieldClass, 'resize-y')}
                          rows={2}
                          placeholder={`${t.blockedReason}…`}
                        />
                      </label>
                      <Button
                        type="submit"
                        variant="secondary"
                        className="h-9 w-fit"
                        disabled={busy != null || !titleDraft.trim()}
                      >
                        {t.saveDetails}
                      </Button>
                    </form>
                  </details>
                </details>

                <details className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-fg marker:hidden">
                    <span className="flex items-center gap-2">
                      <GitBranch className="size-4 text-accent" aria-hidden />
                      {t.workflow}
                    </span>
                    {activeWorkflowRuns.length ? <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-xs text-accent-fg">{formatMessage(t.activeCount, { count: activeWorkflowRuns.length })}</span> : null}
                  </summary>
                  <p className="mt-2 text-sm text-fg-muted">{t.workflowHint}</p>
                  {workflowSuggestions.length ? (
                    <div className="mt-3 grid gap-2">
                      {workflowSuggestions.slice(0, 2).map((suggestion) => (
                        <button
                          key={suggestion.definitionId}
                          type="button"
                          className={cn(
                            'min-w-0 rounded-md bg-surface-muted/40 px-2.5 py-2 text-left hover:bg-accent-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            workflowDefinitionDraft === suggestion.definitionId && 'bg-accent-soft/60 ring-1 ring-accent/30',
                          )}
                          onClick={() => {
                            setWorkflowDefinitionDraft(suggestion.definitionId);
                            setWorkflowGoalDraft(goal.nextAction || goal.title);
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-fg">{suggestion.title}</span>
                            <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">{suggestion.score}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{suggestion.description}</p>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-2">
                    <label className="grid gap-1 text-xs font-medium text-fg-muted">
                      {t.definition}
                      <Select
                        value={workflowDefinitionDraft}
                        onChange={(e) => setWorkflowDefinitionDraft(e.target.value)}
                        className={fieldClass}
                        name="workflowDefinition"
                        disabled={workflowDefinitions.length === 0}
                      >
                        {workflowDefinitions.length === 0 ? <SelectOption value="">{t.noWorkflows}</SelectOption> : null}
                        {workflowDefinitions.map((definition) => (
                          <SelectOption key={definition.id} value={definition.id}>
                            {definition.title || definition.name}
                          </SelectOption>
                        ))}
                      </Select>
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-fg-muted">
                      {t.workflowGoal}
                      <input
                        value={workflowGoalDraft}
                        onChange={(e) => setWorkflowGoalDraft(e.target.value)}
                        name="workflowGoal"
                        autoComplete="off"
                        className={fieldClass}
                        placeholder={`${t.workflowGoal}…`}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-9 w-fit gap-2"
                      disabled={busy != null || !workflowDefinitionDraft || goal.status === 'done' || goal.status === 'archived'}
                      onClick={() => void runWorkflowForGoal()}
                    >
                      <CirclePlay className="size-4" aria-hidden />
                      {t.runWorkflow}
                    </Button>
                  </div>
                  {workflowRuns.length ? (
                    <div className="mt-4 border-t border-edge pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-fg">{t.recentWorkflowRuns}</h3>
                        <button
                          type="button"
                          className="text-xs text-fg-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          onClick={() => setTimelineFilter('workflow_run')}
                        >
                          {t.viewTimeline}
                        </button>
                      </div>
                      <ul className="grid gap-2">
                        {workflowRuns.slice(0, 3).map((run) => {
                          const sessionKey = run.metadata?.sessionKey;
                          const isActive = run.status === 'queued' || run.status === 'running';
                          const canRetry = run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled';
                          return (
                            <li key={run.id} className="rounded-md bg-surface-muted/40 px-2.5 py-2 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
                                <span className="min-w-0 truncate">{run.definitionId}</span>
                                <span className={cn('shrink-0 rounded-full border px-2 py-0.5', workflowStatusClass(run.status))}>{statusLabel(run.status, t)}</span>
                              </div>
                              <p className="mt-1 truncate text-fg">{run.title}</p>
                              <time className="mt-1 block text-xs text-fg-muted">{formatDateTime(run.completedAtMs ?? run.startedAtMs ?? run.createdAtMs, language, t)}</time>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {sessionKey ? (
                                  <Button type="button" variant="ghost" className="h-8 gap-1.5" onClick={() => navigate(`/chat/${encodeURIComponent(sessionKey)}`)}>
                                    <ExternalLink className="size-3.5" aria-hidden />
                                    {t.chat}
                                  </Button>
                                ) : null}
                                {isActive ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-8 gap-1.5 text-destructive hover:text-destructive"
                                    disabled={busy != null}
                                    onClick={() => void cancelGoalWorkflowRun(run)}
                                  >
                                    <XCircle className="size-3.5" aria-hidden />
                                    {t.cancel}
                                  </Button>
                                ) : null}
                                {canRetry ? (
                                  <Button type="button" variant="ghost" className="h-8 gap-1.5" disabled={busy != null} onClick={() => void retryGoalWorkflowRun(run)}>
                                    <RefreshCw className="size-3.5" aria-hidden />
                                    {t.retry}
                                  </Button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  {failedWorkflowRuns.length ? (
                    <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t.recoveryNeeded}</p>
                        <span className="text-xs text-amber-700 dark:text-amber-300">{formatMessage(t.failedCount, { count: failedWorkflowRuns.length })}</span>
                      </div>
                      <ul className="mt-2 grid gap-2">
                        {failedWorkflowRuns.slice(0, 3).map((run) => (
                          <li key={run.id} className="grid gap-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate text-fg">{run.title}</p>
                              <p className="text-xs text-fg-muted">{run.definitionId} · {statusLabel(run.status, t)}</p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Button type="button" variant="ghost" className="h-8 gap-1.5" onClick={() => navigate(`/workflows?run=${encodeURIComponent(run.id)}`)}>
                                <ExternalLink className="size-3.5" aria-hidden />
                                {t.run}
                              </Button>
                              <Button type="button" variant="secondary" className="h-8 gap-1.5" disabled={busy != null} onClick={() => void retryGoalWorkflowRun(run)}>
                                <RefreshCw className="size-3.5" aria-hidden />
                                {t.retry}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </details>
              </aside>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
