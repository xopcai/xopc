import {
  Activity,
  ArrowLeft,
  Archive,
  Bot,
  CheckCircle2,
  Circle,
  CirclePause,
  CirclePlay,
  Code2,
  FileText,
  ExternalLink,
  FilePlus2,
  GitBranch,
  ListChecks,
  Plus,
  RefreshCw,
  ScrollText,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
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
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [priorityDraft, setPriorityDraft] = useState<GoalDetail['priority']>('normal');
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [maxTurnsDraft, setMaxTurnsDraft] = useState('10');
  const [judgeModelDraft, setJudgeModelDraft] = useState('');
  const [nextActionDraft, setNextActionDraft] = useState('');
  const [blockedReasonDraft, setBlockedReasonDraft] = useState('');
  const [workflowDefinitionDraft, setWorkflowDefinitionDraft] = useState('');
  const [workflowGoalDraft, setWorkflowGoalDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setWorkflowGoalDraft((current) => current || goal.nextAction || goal.title);
  }, [goal?.id, goal?.updatedAt]);

  const continueGoal = async () => {
    if (!goal) return;
    setBusy('continue');
    try {
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
          }),
        },
      );
      setEvidence((items) => [res.evidence, ...items]);
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
  const failedWorkflowRuns = workflowRuns.filter((run) => run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled');
  const latestRun = runs[0];
  const timelineFilter = isTimelineFilter(searchParams.get('timeline')) ? searchParams.get('timeline') : 'all';
  const filteredActivity = timelineFilter === 'all' ? activity : activity.filter((item) => item.kind === timelineFilter);
  const activeWorkflowRuns = workflowRuns.filter((run) => run.status === 'queued' || run.status === 'running');
  const primaryActionDisabled = busy != null || goal?.status === 'done' || goal?.status === 'archived';

  const headerEnd = useMemo(() => {
    if (!goal) return null;
    return (
      <>
        <Button
          type="button"
          variant="primary"
          className="h-9 gap-2 rounded-lg px-2.5 md:px-3"
          aria-label={primaryActionLabel(goal.status, t)}
          disabled={primaryActionDisabled}
          onClick={() => void continueGoal()}
        >
          <CirclePlay className="size-4" aria-hidden />
          <span className="hidden md:inline">{primaryActionLabel(goal.status, t)}</span>
        </Button>
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
          variant="secondary"
          className="h-9 gap-2 rounded-lg px-2.5 md:px-3"
          aria-label={t.pause}
          disabled={busy != null || goal.status !== 'active'}
          onClick={() => void postAction('pause')}
        >
          <CirclePause className="size-4" aria-hidden />
          <span className="hidden md:inline">{t.pause}</span>
        </Button>
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
  }, [busy, goal, navigate, primaryActionDisabled, t]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: (
        <Link to="/goals" className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={t.back}>
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      ),
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{goal?.title ?? (loading ? t.loading : t.notFound)}</h1>
          {goal ? (
            <p className="truncate text-xs text-fg-muted">
              {statusLabel(goal.status, t)} · {formatMessage(t.agent, { agentId: goal.agentId })} · {formatMessage(t.turns, { used: goal.turnsUsed, max: goal.maxTurns })}
              {total ? ` · ${formatMessage(t.checklistProgress, { done, total })}` : ''}
            </p>
          ) : null}
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, done, goal, headerEnd, loading, setPageHeader, t, total]);

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
        {loading ? <p className="text-sm text-fg-muted">{t.loading}</p> : null}
        {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        {!loading && !goal ? <p className="text-sm text-fg-muted">{t.notFound}</p> : null}

        {goal ? (
          <>
            <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2 py-0.5 text-xs', badgeClass(goal.status))}>{statusLabel(goal.status, t)}</span>
                <span className="text-xs text-fg-muted">{formatMessage(t.prioritySummary, { priority: priorityLabel(goal.priority, t) })}</span>
                <span className="text-xs text-fg-muted">{goal.deadlineAt ? formatDate(goal.deadlineAt, language, t) : t.noDeadline}</span>
              </div>
              {goal.description ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-fg-muted">{goal.description}</p> : null}
              <div className="mt-3 rounded-md bg-surface-muted/40 px-3 py-2">
                <p className="text-xs font-medium text-fg-muted">{goal.blockedReason ? t.currentBlocker : t.nextAction}</p>
                <p className={cn('mt-1 break-words text-sm', goal.blockedReason ? 'text-amber-700 dark:text-amber-300' : 'text-fg')}>
                  {goal.blockedReason || goal.nextAction || t.noNextAction}
                </p>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="grid min-w-0 gap-4">
                <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
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
                    {evidence.length ? (
                      <ul className="space-y-2 text-sm">
                        {evidence.slice(0, 6).map((item) => <EvidenceCard key={item.id} item={item} language={language} t={t} />)}
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
                </section>
              </div>

              <aside className="grid h-fit gap-4">
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
                <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
                  <h2 className="text-sm font-semibold text-fg">{t.goalSettings}</h2>
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
                </section>

                <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                        <GitBranch className="size-4 text-accent" aria-hidden />
                        {t.workflow}
                      </h2>
                      <p className="mt-1 text-sm text-fg-muted">{t.workflowHint}</p>
                    </div>
                    {activeWorkflowRuns.length ? <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-xs text-accent-fg">{formatMessage(t.activeCount, { count: activeWorkflowRuns.length })}</span> : null}
                  </div>
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
                </section>
              </aside>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
