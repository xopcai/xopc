import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  GitBranch,
  ListTree,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Skeleton } from '@/components/ui/skeleton';
import { TimePicker } from '@/components/ui/time-picker';
import { AiTextAssistButton } from '@/features/ai-assist/ai-text-assist-button';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { fetchProjects, type Project } from '@/features/projects/api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { messages, type MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { listWorkflowDefinitions, type WorkflowDefinition } from '@/features/workflows/workflow-api';
import { browserAutomationApi, type BrowserAutomation } from '@/features/browser-automations/browser-automation-api';
import {
  browserAutomationInputsComplete,
  defaultBrowserAutomationInputs,
} from '@/features/browser-automations/browser-automation-input-utils';
import { BrowserAutomationInputFields } from '@/features/browser-automations/browser-automation-inputs';
import { validateWorkflowInputEditorValue } from '@/features/workflows/workflow-input-editor.utils';
import { WorkflowRunSetupPanel } from '@/features/workflows/workflow-run-setup-panel';
import {
  automationApi,
  type Automation,
  type AutomationAction,
  type AutomationDraft,
  type AutomationRepairDraft,
  type AutomationRun,
  type AutomationRunEvent,
  type AutomationSafetyMode,
  type AutomationConversationMode,
  type AutomationNotificationPolicy,
  type AutomationTaskOption,
} from './automation-api';
import { Select, SelectOption } from '@/components/ui/popover-select';
import {
  automationIntervalMs,
  automationLastRunLabel,
  automationNextRunLabel,
  automationTriggerLabel,
  convertAutomationIntervalValue,
  formatAutomationDateTime,
  formatAutomationDuration,
  formatAutomationInterval,
  formatAutomationRelativeDateTime,
  type AutomationIntervalUnit,
} from './automation-display';
import {
  buildAutomationEditInput,
  buildInput,
  formFromAutomation,
  initialForm,
  INTERVAL_PRESETS,
  payloadMatchIsValid,
  type ActionMode,
  type FormState,
  type TriggerMode,
} from './automation-form';

import { automationScenarios, type AutomationTemplate } from './automation-scenarios';
import { AutomationQuickCreate } from './automation-quick-create';
import { automationChatCreateHref } from './automation-create-navigation';
import {
  automationExecutionIssueMarker,
  automationHasExecutionIssue,
  latestAutomationRun,
} from './automation-result-state';

type CreateMode = 'blank' | 'draft' | 'quick';
type AutomationFilter = 'all' | 'active' | 'paused' | 'running' | 'attention';
type AutomationOwnership = 'user' | 'system';
type AutomationSourceFilter = 'all' | AutomationAction['kind'];
type AutomationsMessages = MessageBundle['automations'];
type CronMessages = MessageBundle['cron'];
type RunEventLabels = AutomationsMessages['events'];

const DISMISSED_EXECUTION_ISSUES_STORAGE_KEY = 'xopc.automations.dismissedExecutionIssues';

function readDismissedExecutionIssues(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(DISMISSED_EXECUTION_ISSUES_STORAGE_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function formatDate(ms: number | undefined, labels: AutomationsMessages, language: StoredLanguage): string {
  if (!ms) return labels.never;
  return formatAutomationDateTime(ms, language);
}

function actionLabel(action: AutomationAction, labels: AutomationsMessages): string {
  if (action.kind === 'system') {
    if (action.capability === 'home.advisor.refresh') return 'Home AI suggestions refresh';
    if (action.capability === 'memory.temporal_sweep') return 'Memory temporal sweep';
    if (action.capability === 'memory.daily_reconciliation') return 'Memory daily reconciliation';
    return 'Memory weekly knowledge maintenance';
  }
  if (action.kind === 'workflow') return labels.action.workflowWithId.replace('{id}', action.workflowId);
  if (action.kind === 'browser_automation') return `Browser automation: ${action.automationId}`;
  if (action.kind === 'task_command') return labels.action.taskWithId.replace('{id}', action.taskId);
  return action.agentId ? labels.action.agentWithId.replace('{id}', action.agentId) : labels.action.agent;
}

function actionKindLabel(action: AutomationAction, labels: AutomationsMessages): string {
  if (action.kind === 'system') return 'System';
  if (action.kind === 'workflow') return labels.sources.workflow;
  if (action.kind === 'browser_automation') return labels.sources.browser;
  if (action.kind === 'task_command') return labels.sources.task;
  return labels.sources.agent;
}

function actionModeLabel(mode: ActionMode, labels: AutomationsMessages): string {
  if (mode === 'workflow') return labels.action.runWorkflow;
  if (mode === 'browser_automation') return labels.sources.browser;
  if (mode === 'task_command') return labels.action.runTask;
  return labels.action.runAgent;
}

function triggerModeLabel(mode: TriggerMode, labels: AutomationsMessages): string {
  if (mode === 'cron') return labels.trigger.customCron;
  if (mode === 'event') return labels.trigger.customEvent;
  return labels.trigger[mode];
}

function AutomationSourceIcon({ kind, className }: { kind: AutomationAction['kind']; className?: string }) {
  if (kind === 'system') return <Zap className={className} aria-hidden />;
  if (kind === 'workflow') return <GitBranch className={className} aria-hidden />;
  if (kind === 'browser_automation') return <ListTree className={className} aria-hidden />;
  if (kind === 'task_command') return <CheckCircle2 className={className} aria-hidden />;
  return <Sparkles className={className} aria-hidden />;
}

function safetyMode(automation: Automation): AutomationSafetyMode {
  return automation.safety?.mode ?? 'auto_apply';
}

function statusClass(status?: AutomationRun['status']) {
  if (status === 'succeeded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'running' || status === 'queued' || status === 'cancelling') return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
  return 'bg-surface-hover text-fg-muted';
}

function formatDuration(ms: number | undefined, labels: AutomationsMessages): string {
  if (ms == null) return labels.never;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function isActiveRun(run: AutomationRun): boolean {
  return run.status === 'running' || run.status === 'queued' || run.status === 'cancelling';
}

function needsAttention(run: AutomationRun): boolean {
  return run.status === 'failed' || run.status === 'timeout';
}

function automationTaskSummary(automation: Automation, labels: AutomationsMessages): string {
  if (automation.action.kind === 'system') return actionLabel(automation.action, labels);
  if (automation.action.kind === 'agent') return automation.action.instruction;
  if (automation.action.kind === 'workflow') {
    return automation.action.goal?.trim() || actionLabel(automation.action, labels);
  }
  if (automation.action.kind === 'task_command') return actionLabel(automation.action, labels);
  return actionLabel(automation.action, labels);
}

export function isSystemManagedAutomation(automation: Automation): boolean {
  return automation.management !== undefined;
}

function visibleAutomationDescription(automation: Automation): string {
  return automation.description?.trim() ?? '';
}

function runSortWeight(run: AutomationRun): number {
  if (isActiveRun(run)) return 0;
  if (needsAttention(run)) return 1;
  if (run.status === 'succeeded') return 2;
  return 3;
}

function sortRunsForOperations(runs: AutomationRun[]): AutomationRun[] {
  return [...runs].sort((a, b) => {
    const weight = runSortWeight(a) - runSortWeight(b);
    if (weight !== 0) return weight;
    return b.createdAtMs - a.createdAtMs;
  });
}

function AutomationsPageSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge-subtle bg-edge-subtle xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex min-h-12 items-center gap-2.5 bg-surface-base px-3 py-2.5">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="ml-auto h-4 w-10" />
            </div>
          ))}
      </section>
      <div className="grid min-h-0 items-start gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
        <section className="rounded-xl bg-surface-panel p-4 shadow-surface">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
          <div className="mt-4 grid gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg bg-surface-base p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Skeleton className="size-4 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                    <Skeleton className="mt-3 h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-3/5" />
                  </div>
                  <Skeleton className="h-8 w-24 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="hidden rounded-xl bg-surface-panel p-4 shadow-surface xl:block">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-24 rounded-lg" />
          <div className="mt-4 grid gap-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        </section>
      </div>
    </div>
  );
}

export type AutomationsWorkspaceProps = {
  projectId?: string;
  embedded?: boolean;
  title?: string;
  subtitle?: string;
};

export function AutomationsWorkspace({
  projectId,
  embedded = false,
  title,
  subtitle,
}: AutomationsWorkspaceProps) {
  const language = useLocaleStore((s) => s.language);
  const messageBundle = messages(language);
  const labels = messageBundle.automations;
  const pageTitle = messageBundle.productNavigation.sections['automation-triggers'];
  const cronLabels = messageBundle.cron;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activityView = !embedded && searchParams.get('view') === 'activity';
  const runParam = searchParams.get('run')?.trim() ?? '';
  const automationParam = searchParams.get('automation')?.trim() ?? '';
  const draftParam = searchParams.get('draft')?.trim() ?? '';
  const actionParam = searchParams.get('action')?.trim() ?? '';
  const taskIdParam = searchParams.get('taskId')?.trim() ?? '';
  const routeProjectId = searchParams.get('projectId')?.trim() ?? '';
  const projectIdParam = projectId?.trim() || routeProjectId;
  const projectLocked = Boolean(projectId?.trim());
  const autogenerateDraft = searchParams.get('autogenerate') === '1';
  const draftSeedRef = useRef('');
  const filterParam = searchParams.get('status');
  const filter: AutomationFilter = filterParam === 'active' || filterParam === 'paused' || filterParam === 'running' || filterParam === 'attention' ? filterParam : 'all';
  const ownership: AutomationOwnership = searchParams.get('ownership') === 'system' ? 'system' : 'user';
  const sourceParam = searchParams.get('source');
  const sourceFilter: AutomationSourceFilter = sourceParam === 'agent' || sourceParam === 'workflow' || sourceParam === 'task_command' || sourceParam === 'browser_automation' ? sourceParam : 'all';
  const searchQuery = searchParams.get('q') ?? '';
  const setFilter = (value: AutomationFilter) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value === 'all') next.delete('status'); else next.set('status', value);
    next.delete('automation');
    return next;
  });
  const setOwnership = (value: AutomationOwnership) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value === 'user') next.delete('ownership'); else next.set('ownership', value);
    next.delete('automation');
    return next;
  });
  const setSearchQuery = (value: string) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value) next.set('q', value); else next.delete('q');
    next.delete('automation');
    return next;
  }, { replace: true });
  const setSourceFilter = (value: AutomationSourceFilter) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value === 'all') next.delete('source'); else next.set('source', value);
    next.delete('automation');
    return next;
  });
  const clearListFilters = () => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    next.delete('status');
    next.delete('source');
    next.delete('q');
    next.delete('automation');
    return next;
  });
  const [quickTemplate, setQuickTemplate] = useState<AutomationTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('blank');
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetailOpen, setRunDetailOpen] = useState(false);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftApproved, setDraftApproved] = useState(false);
  const [draftProjectId, setDraftProjectId] = useState(projectIdParam);
  const [draftConversationMode, setDraftConversationMode] = useState<AutomationConversationMode>('new_session');
  const [draftNotificationPolicy, setDraftNotificationPolicy] = useState<AutomationNotificationPolicy>('attention');
  const [repairDraft, setRepairDraft] = useState<AutomationRepairDraft | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairApproved, setRepairApproved] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [dismissedExecutionIssues, setDismissedExecutionIssues] = useState(readDismissedExecutionIssues);

  const automationsSwr = useSWR(
    ['automations', projectIdParam],
    () => automationApi.list(projectIdParam ? { projectId: projectIdParam } : undefined),
    { keepPreviousData: true, refreshInterval: 15_000 },
  );
  const runsSwr = useSWR(
    ['automation-runs', projectIdParam],
    () => automationApi.runs(50, undefined, projectIdParam ? { projectId: projectIdParam } : undefined),
    { keepPreviousData: true, refreshInterval: 10_000 },
  );
  const globalAutomationsSwr = useSWR(
    projectIdParam ? 'automations-global-system-source' : null,
    () => automationApi.list(),
    { keepPreviousData: true, refreshInterval: 15_000 },
  );
  const globalRunsSwr = useSWR(
    projectIdParam ? 'automation-runs-global-system-source' : null,
    () => automationApi.runs(50),
    { keepPreviousData: true, refreshInterval: 10_000 },
  );
  const selectedRunsSwr = useSWR(
    selectedAutomationId ? ['automation-history', selectedAutomationId, projectIdParam] : null,
    () => automationApi.runs(50, selectedAutomationId!, projectIdParam ? { projectId: projectIdParam } : undefined),
    { refreshInterval: 10_000 },
  );
  const runEventsSwr = useSWR(
    selectedRunId ? `automation-run-events:${selectedRunId}` : null,
    () => automationApi.runEvents(selectedRunId!),
    { refreshInterval: 5_000 },
  );
  const workflowDefinitionsSwr = useSWR('automation-workflow-definitions', listWorkflowDefinitions);
  const browserAutomationsSwr = useSWR('automation-browser-automations', () => browserAutomationApi.list());
  const chatAgentsSwr = useSWR('automation-chat-agents', fetchChatAgents);
  const tasksSwr = useSWR('automation-tasks', automationApi.tasks);
  const projectsSwr = useSWR('automation-projects', () => fetchProjects({ sortBy: 'name', sortOrder: 'asc', limit: 200 }));
  const initialLoading =
    (automationsSwr.isLoading && !automationsSwr.data) ||
    (runsSwr.isLoading && !runsSwr.data) ||
    (Boolean(projectIdParam) && globalAutomationsSwr.isLoading && !globalAutomationsSwr.data) ||
    (Boolean(projectIdParam) && globalRunsSwr.isLoading && !globalRunsSwr.data);
  const scopeLoading = !initialLoading && (
    automationsSwr.isLoading ||
    runsSwr.isLoading ||
    globalAutomationsSwr.isLoading ||
    globalRunsSwr.isLoading
  );

  const scopedAutomations = automationsSwr.data?.automations ?? [];
  const globalAutomations = projectIdParam
    ? globalAutomationsSwr.data?.automations ?? []
    : scopedAutomations;
  const runs = useMemo(() => sortRunsForOperations(runsSwr.data?.runs ?? []), [runsSwr.data?.runs]);
  const globalRuns = useMemo(
    () => projectIdParam
      ? sortRunsForOperations(globalRunsSwr.data?.runs ?? [])
      : runs,
    [globalRunsSwr.data?.runs, projectIdParam, runs],
  );
  const userAutomations = useMemo(
    () => scopedAutomations.filter((automation) => !isSystemManagedAutomation(automation)),
    [scopedAutomations],
  );
  const systemAutomations = useMemo(
    () => globalAutomations.filter(isSystemManagedAutomation),
    [globalAutomations],
  );
  const availableAutomations = useMemo(
    () => [...userAutomations, ...systemAutomations],
    [systemAutomations, userAutomations],
  );
  const systemAutomationIds = useMemo(
    () => new Set(systemAutomations.map((automation) => automation.id)),
    [systemAutomations],
  );
  const userRuns = useMemo(
    () => runs.filter((run) => !systemAutomationIds.has(run.automationId)),
    [runs, systemAutomationIds],
  );
  const systemRuns = useMemo(
    () => globalRuns.filter((run) => systemAutomationIds.has(run.automationId)),
    [globalRuns, systemAutomationIds],
  );
  const availableRuns = useMemo(
    () => projectIdParam ? [...runs, ...systemRuns] : runs,
    [projectIdParam, runs, systemRuns],
  );
  const selectedRun = useMemo(
    () => availableRuns.find((run) => run.id === selectedRunId) ?? selectedRunsSwr.data?.runs.find((run) => run.id === selectedRunId) ?? null,
    [availableRuns, selectedRunId, selectedRunsSwr.data],
  );
  const selectedAutomation = useMemo(
    () => availableAutomations.find((automation) => automation.id === selectedAutomationId) ?? null,
    [availableAutomations, selectedAutomationId],
  );
  const editingAutomation = useMemo(
    () => availableAutomations.find((automation) => automation.id === editingAutomationId) ?? null,
    [availableAutomations, editingAutomationId],
  );
  const selectedAutomationRuns = useMemo(
    () => [...(selectedRunsSwr.data?.runs ?? availableRuns)]
      .filter((run) => run.automationId === selectedAutomationId)
      .sort((a, b) => b.createdAtMs - a.createdAtMs),
    [availableRuns, selectedAutomationId, selectedRunsSwr.data],
  );
  const runEvents = runEventsSwr.data?.events ?? [];
  const unreadRuns = useMemo(
    () => userRuns.filter((run) => !isActiveRun(run) && run.readAtMs == null),
    [userRuns],
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const ownershipAutomations = ownership === 'system' ? systemAutomations : userAutomations;
  const ownershipRuns = ownership === 'system' ? systemRuns : userRuns;
  const runningAutomationIds = useMemo(
    () => new Set(ownershipRuns.filter(isActiveRun).map((run) => run.automationId)),
    [ownershipRuns],
  );
  const filteredAutomations = useMemo(() => ownershipAutomations.filter((automation) => {
    if (filter === 'attention' && !automationHasExecutionIssue(automation, ownershipRuns)) return false;
    if (filter === 'running' && !runningAutomationIds.has(automation.id)) return false;
    if (filter === 'active' && !automation.enabled) return false;
    if (filter === 'paused' && automation.enabled) return false;
    if (sourceFilter !== 'all' && automation.action.kind !== sourceFilter) return false;
    if (!normalizedSearch) return true;
    return [
      automation.name,
      visibleAutomationDescription(automation),
      automationTaskSummary(automation, labels),
      automationTriggerLabel(automation.trigger, labels, cronLabels, language),
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
  }), [cronLabels, filter, labels, language, normalizedSearch, ownershipAutomations, ownershipRuns, runningAutomationIds, sourceFilter]);
  const workflowDefinitions = useMemo(() => workflowDefinitionsSwr.data ?? [], [workflowDefinitionsSwr.data]);
  const browserAutomations = useMemo(
    () => (browserAutomationsSwr.data?.automations ?? []).filter((automation) => automation.enabled),
    [browserAutomationsSwr.data],
  );
  const agentOptions = chatAgentsSwr.data?.items ?? [];
  const taskOptions = useMemo(
    () => (tasksSwr.data?.items ?? []).map((item) => item.task),
    [tasksSwr.data],
  );
  const projects = projectsSwr.data?.items ?? [];
  const selectedWorkflow = useMemo(
    () => workflowDefinitions.find((workflow) => workflow.id === form.workflowId.trim()) ?? null,
    [form.workflowId, workflowDefinitions],
  );
  const selectedBrowserAutomation = useMemo(
    () => browserAutomations.find((automation) => automation.id === form.browserAutomationId.trim()) ?? null,
    [browserAutomations, form.browserAutomationId],
  );
  const workflowSelectionInvalid =
    form.actionMode === 'workflow' &&
    (!form.workflowId.trim() ||
      (workflowDefinitions.length > 0 && !workflowDefinitions.some((workflow) => workflow.id === form.workflowId)));
  const workflowInputInvalid =
    form.actionMode === 'workflow' && selectedWorkflow
      ? !validateWorkflowInputEditorValue(selectedWorkflow, form.workflowInput, form.workflowInputValid).valid
      : false;
  const managedTriggerEdit = Boolean(editingAutomation?.management?.editable.includes('trigger'));
  const managedTriggerValid = ['daily', 'weekly', 'interval', 'cron'].includes(form.triggerMode)
    && (!['daily', 'weekly'].includes(form.triggerMode) || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(form.time))
    && (form.triggerMode !== 'interval' || automationIntervalMs(form.intervalValue, form.intervalUnit) >= 60_000)
    && (form.triggerMode !== 'cron' || Boolean(form.cronExpr.trim()));
  const formCanSubmit = managedTriggerEdit
    ? managedTriggerValid
    : Boolean(form.name.trim()) &&
    (form.triggerMode !== 'once' || (Number.isFinite(new Date(form.onceAt).getTime()) && (Boolean(editingAutomation) || new Date(form.onceAt).getTime() > Date.now()))) &&
    (!['daily', 'weekly'].includes(form.triggerMode) || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(form.time)) &&
    (form.triggerMode !== 'event' || (Boolean(form.eventType.trim()) && payloadMatchIsValid(form.eventPayloadMatch))) &&
    (form.actionMode === 'workflow'
      ? !workflowSelectionInvalid && !workflowInputInvalid
      : form.actionMode === 'browser_automation'
        ? selectedBrowserAutomation !== null && browserAutomationInputsComplete(selectedBrowserAutomation, form.browserAutomationInputs)
        : form.actionMode === 'task_command'
          ? Boolean(form.taskId.trim() && form.agentId.trim())
        : Boolean(form.instruction.trim()));
  const templates = useMemo(() => automationScenarios(labels), [labels]);
  const executionIssues = useMemo(
    () => userAutomations.filter((automation) => automationHasExecutionIssue(automation, userRuns)),
    [userAutomations, userRuns],
  );
  const ownershipExecutionIssues = useMemo(
    () => ownershipAutomations.filter((automation) => automationHasExecutionIssue(automation, ownershipRuns)),
    [ownershipAutomations, ownershipRuns],
  );
  const hasUndismissedExecutionIssues = executionIssues.some((automation) => {
    const marker = automationExecutionIssueMarker(automation, userRuns);
    return marker !== null && dismissedExecutionIssues[automation.id] !== marker;
  });
  const runningRunCount = ownershipRuns.filter(isActiveRun).length;
  const nextAutomation = ownershipAutomations
    .filter((automation) => automation.enabled && automation.state.nextRunAtMs)
    .sort((a, b) => (a.state.nextRunAtMs ?? Number.POSITIVE_INFINITY) - (b.state.nextRunAtMs ?? Number.POSITIVE_INFINITY))[0];
  const sourceCounts = useMemo(() => ({
    all: ownershipAutomations.length,
    agent: ownershipAutomations.filter((automation) => automation.action.kind === 'agent').length,
    workflow: ownershipAutomations.filter((automation) => automation.action.kind === 'workflow').length,
    task_command: ownershipAutomations.filter((automation) => automation.action.kind === 'task_command').length,
    browser_automation: ownershipAutomations.filter((automation) => automation.action.kind === 'browser_automation').length,
  }), [ownershipAutomations]);
  const appliedFilterCount = Number(filter !== 'all') + Number(sourceFilter !== 'all');

  const dismissExecutionIssues = useCallback(() => {
    setDismissedExecutionIssues((current) => {
      const next = { ...current };
      for (const automation of executionIssues) {
        const marker = automationExecutionIssueMarker(automation, userRuns);
        if (marker) next[automation.id] = marker;
      }
      try {
        window.localStorage.setItem(DISMISSED_EXECUTION_ISSUES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Keep the dismissal for this page even when persistent storage is unavailable.
      }
      return next;
    });
  }, [executionIssues, userRuns]);

  useEffect(() => {
    if (scopeLoading) return;
    if (filteredAutomations.length === 0) {
      setSelectedAutomationId(null);
      return;
    }
    if (automationParam && filteredAutomations.some((automation) => automation.id === automationParam)) {
      setSelectedAutomationId(automationParam);
      return;
    }
    if (selectedAutomationId && filteredAutomations.some((automation) => automation.id === selectedAutomationId)) return;
    setSelectedAutomationId(filteredAutomations[0].id);
  }, [automationParam, filteredAutomations, scopeLoading, selectedAutomationId]);

  const reload = useCallback(async () => {
    await Promise.all([
      automationsSwr.mutate(),
      runsSwr.mutate(),
      globalAutomationsSwr.mutate(),
      globalRunsSwr.mutate(),
      selectedRunsSwr.mutate(),
      runEventsSwr.mutate(),
    ]);
  }, [automationsSwr.mutate, globalAutomationsSwr.mutate, globalRunsSwr.mutate, runEventsSwr.mutate, runsSwr.mutate, selectedRunsSwr.mutate]);

  const selectProject = useCallback((projectId: string) => {
    if (projectLocked) {
      setSelectedAutomationId(null);
      setSelectedRunId(null);
      return;
    }
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (projectId) next.set('projectId', projectId);
      else next.delete('projectId');
      next.delete('automation');
      next.delete('run');
      return next;
    });
    setSelectedAutomationId(null);
    setSelectedRunId(null);
  }, [projectLocked, setSearchParams]);

  useEffect(() => {
    if (!projectLocked) return;
    setDraftProjectId(projectIdParam);
    setForm((previous) => previous.projectId === projectIdParam
      ? previous
      : { ...previous, projectId: projectIdParam });
  }, [projectIdParam, projectLocked]);

  const openCreate = useCallback((mode: CreateMode) => {
    setEditingAutomationId(null);
    setEditingDraft(false);
    setError(null);
    setCreateMode(mode);
    setCreateOpen(true);
    if (mode === 'blank') {
      setForm({ ...initialForm, projectId: projectIdParam });
      return;
    }
    setDraftPrompt('');
    setDraft(null);
    setDraftApproved(false);
    setDraftProjectId(projectIdParam);
    setDraftConversationMode('new_session');
    setDraftNotificationPolicy('attention');
  }, [projectIdParam]);

  const openChatCreate = useCallback(() => {
    navigate(automationChatCreateHref(labels.createWithAssistantPrompt, projectIdParam));
  }, [labels.createWithAssistantPrompt, navigate, projectIdParam]);

  const selectTemplate = (template: AutomationTemplate) => {
    setQuickTemplate(template);
    setForm({ ...template.form, projectId: projectIdParam });
    setEditingAutomationId(null);
    setEditingDraft(false);
    setError(null);
    setCreateMode('quick');
    setCreateOpen(true);
  };

  const openAutomationEditor = useCallback((automation: Automation) => {
    setForm(formFromAutomation(automation, workflowDefinitions));
    setEditingAutomationId(automation.id);
    setEditingDraft(false);
    setSelectedAutomationId(null);
    setCreateMode('blank');
    setCreateOpen(true);
  }, [workflowDefinitions]);

  const openDraftEditor = useCallback(() => {
    if (!draft) return;
    setForm({
      ...formFromAutomation(draft.automation, workflowDefinitions),
      projectId: draftProjectId,
      conversationMode: draftConversationMode,
      notificationPolicy: draftNotificationPolicy,
    });
    setEditingAutomationId(null);
    setEditingDraft(true);
    setCreateMode('blank');
  }, [draft, draftConversationMode, draftNotificationPolicy, draftProjectId, workflowDefinitions]);

  const refreshNow = useCallback(async () => {
    setRefreshBusy(true);
    setError(null);
    try {
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setRefreshBusy(false);
    }
  }, [labels.feedback.actionFailed, reload]);

  useEffect(() => {
    const automation = availableAutomations.find((item) => item.id === automationParam);
    if (!automation || !isSystemManagedAutomation(automation) || ownership === 'system') return;
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('ownership', 'system'); return next; }, { replace: true });
  }, [automationParam, availableAutomations, ownership, setSearchParams]);

  useEffect(() => {
    if (actionParam !== 'create') return;
    openCreate('blank');
    if (taskIdParam) {
      setForm((previous) => ({
        ...previous,
        actionMode: 'task_command',
        taskId: taskIdParam,
        safetyMode: 'auto_apply',
      }));
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('action');
      next.delete('taskId');
      return next;
    }, { replace: true });
  }, [actionParam, openCreate, setSearchParams, taskIdParam]);

  useEffect(() => {
    if (!draftParam) return;
    const marker = `${language}:${autogenerateDraft ? 'auto' : 'seed'}:${draftParam}`;
    if (draftSeedRef.current === marker) return;
    draftSeedRef.current = marker;
    setDraftPrompt(draftParam);
    setDraft(null);
    setDraftApproved(false);
    setDraftProjectId(projectIdParam);
    setCreateMode('draft');
    setCreateOpen(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('draft');
      next.delete('autogenerate');
      return next;
    }, { replace: true });
    if (!autogenerateDraft) return;
    setError(null);
    setDraftLoading(true);
    void automationApi.draft({ prompt: draftParam, language })
      .then((result) => {
        setDraft(result.draft);
        setDraftApproved(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setDraftLoading(false);
      });
  }, [autogenerateDraft, draftParam, language, projectIdParam, setSearchParams]);

  const markRunRead = useCallback((runId: string) => {
    const run = runs.find((item) => item.id === runId) ?? selectedRunsSwr.data?.runs.find((item) => item.id === runId);
    if (!run || isActiveRun(run) || run.readAtMs != null) return;
    const readAtMs = Date.now();
    void runsSwr.mutate((current) => current ? {
      ...current,
      runs: current.runs.map((run) => run.id === runId ? { ...run, readAtMs } : run),
    } : current, false);
    void selectedRunsSwr.mutate((current) => current ? { ...current, runs: current.runs.map((item) => item.id === runId ? { ...item, readAtMs } : item) } : current, false);
    void automationApi.markRunRead(runId).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      void runsSwr.mutate();
      void selectedRunsSwr.mutate();
    });
  }, [runs, runsSwr.mutate, selectedRunsSwr.data, selectedRunsSwr.mutate]);

  const selectRun = useCallback((runId: string) => {
    markRunRead(runId);
    setSelectedRunId(runId);
    setRunDetailOpen(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('run', runId);
      return next;
    }, { replace: true });
  }, [markRunRead, setSearchParams]);

  const openAutomationDetails = useCallback((automationId: string) => {
    setSelectedAutomationId(automationId);
    const latestRun = latestAutomationRun(automationId, availableRuns);
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('automation', automationId); return next; }, { replace: true });
    if (latestRun && latestRun.readAtMs == null && !isActiveRun(latestRun)) markRunRead(latestRun.id);
  }, [availableRuns, markRunRead, setSearchParams]);

  const openNextAutomation = useCallback(() => {
    if (!nextAutomation) return;
    setSelectedAutomationId(nextAutomation.id);
    const latestRun = latestAutomationRun(nextAutomation.id, availableRuns);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('status');
      next.delete('source');
      next.delete('q');
      next.set('automation', nextAutomation.id);
      return next;
    }, { replace: true });
    if (latestRun && latestRun.readAtMs == null && !isActiveRun(latestRun)) markRunRead(latestRun.id);
  }, [availableRuns, markRunRead, nextAutomation, setSearchParams]);

  useEffect(() => {
    if (!runParam) return;
    markRunRead(runParam);
    setSelectedRunId(runParam);
    setRunDetailOpen(true);
  }, [markRunRead, runParam]);

  useEffect(() => {
    setRepairDraft(null);
    setRepairApproved(false);
  }, [selectedRunId]);

  async function submitForm() {
    setError(null);
    if (form.triggerMode === 'once' && !editingAutomation && new Date(form.onceAt).getTime() <= Date.now()) {
      setError(labels.experience.futureTime);
      return;
    }
    if (!formCanSubmit || busyAction) return;
    if (createMode === 'quick' && quickTemplate?.requiresProject && !form.projectId) return;
    if (editingDraft && draft) {
      setBusyAction('draft:edit');
      try {
        const automation = buildInput(form, selectedWorkflow);
        const { simulation } = await automationApi.simulate(automation);
        setDraft({ ...draft, automation, simulation });
        setDraftProjectId(form.projectId);
        setDraftConversationMode(form.conversationMode);
        setDraftNotificationPolicy(form.notificationPolicy);
        setDraftApproved(false);
        setEditingDraft(false);
        setCreateMode('draft');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (editingAutomation) {
      const automationId = editingAutomation.id;
      const updated = await mutateAutomation(`automation:${automationId}:edit`, () => (
        automationApi.update(automationId, managedTriggerEdit
          ? { trigger: buildAutomationEditInput(editingAutomation, { ...form, instruction: 'managed' }, null).trigger }
          : buildAutomationEditInput(editingAutomation, form, selectedWorkflow))
      ));
      if (updated) {
        setCreateOpen(false);
        setEditingAutomationId(null);
        setSelectedAutomationId(automationId);
      }
      return;
    }
    setBusyAction('automation:create');
    try {
      const input = buildInput(form, selectedWorkflow);
      const { automation } = await automationApi.create(input);
      setForm(initialForm);
      setCreateOpen(false);
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.delete('status'); next.delete('q'); next.delete('run');
        next.set('automation', automation.id);
        if (!projectLocked) { if (automation.projectId) next.set('projectId', automation.projectId); else next.delete('projectId'); }
        return next;
      });
      await reload();
      setSelectedAutomationId(automation.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function mutateAutomation(actionKey: string, action: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setBusyAction(actionKey);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function markAllRead() {
    await mutateAutomation('runs:read-all', () => automationApi.markAllRunsRead(projectIdParam || undefined));
  }

  async function generateDraft() {
    const prompt = draftPrompt.trim();
    if (!prompt) return;
    setError(null);
    setDraftLoading(true);
    try {
      const result = await automationApi.draft({ prompt, language });
      setDraft(result.draft);
      setDraftApproved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDraftLoading(false);
    }
  }

  async function publishDraft() {
    if (!draft) return;
    let createdId = '';
    let createdProjectId = '';
    const published = await mutateAutomation('draft:publish', async () => {
      const { automation } = await automationApi.create({
        ...draft.automation,
        ...(draftProjectId ? { projectId: draftProjectId } : { projectId: undefined }),
        conversationMode: draftConversationMode,
        notificationPolicy: draftNotificationPolicy,
      });
      setDraft(null);
      setDraftPrompt('');
      setDraftApproved(false);
      setCreateOpen(false);
      setFilter('all');
      setSearchQuery('');
      createdId = automation.id;
      createdProjectId = automation.projectId ?? '';
    });
    if (published && createdId) {
      selectProject(createdProjectId);
      setSelectedAutomationId(createdId);
    }
  }

  async function testDraft() {
    if (!draft) return;
    let createdId = '';
    let createdProjectId = '';
    let runId = '';
    const tested = await mutateAutomation('draft:test', async () => {
      const { automation } = await automationApi.create({
        ...draft.automation,
        ...(draftProjectId ? { projectId: draftProjectId } : { projectId: undefined }),
        conversationMode: draftConversationMode,
        notificationPolicy: draftNotificationPolicy,
        enabled: false,
      });
      const { run } = await automationApi.runNow(automation.id);
      createdId = automation.id;
      createdProjectId = automation.projectId ?? '';
      runId = run.id;
      setDraft(null);
      setDraftPrompt('');
      setDraftApproved(false);
      setCreateOpen(false);
      setFilter('all');
      setSearchQuery('');
    });
    if (tested && createdId && runId) {
      selectProject(createdProjectId);
      setSelectedAutomationId(createdId);
      selectRun(runId);
    }
  }

  async function generateRepairDraft(run: AutomationRun) {
    setError(null);
    setRepairLoading(true);
    setRepairDraft(null);
    setRepairApproved(false);
    try {
      const result = await automationApi.repairDraft(run.id, { language });
      setRepairDraft(result.repair);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairLoading(false);
    }
  }

  async function applyRepairDraft(run: AutomationRun) {
    if (!repairDraft) return;
    await mutateAutomation(`run:${run.id}:repair`, async () => {
      await automationApi.update(run.automationId, repairDraft.patch);
      setRepairDraft(null);
      setRepairApproved(false);
    });
  }

  const headerEnd = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <RefreshButton className="size-9 shrink-0 p-0" loading={refreshBusy} label={labels.refresh} onClick={refreshNow} />
        <div className="inline-flex h-9 shrink-0" role="group" aria-label={labels.createOptions}>
          <Button
            variant="primary"
            className="h-9 rounded-r-none pr-2.5"
            onClick={openChatCreate}
          >
            <Plus className="size-4" aria-hidden />
            {labels.create}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="primary"
                className="h-9 w-9 rounded-l-none border-l border-white/20 px-0"
                aria-label={labels.createOptions}
                title={labels.createOptions}
              >
                <ChevronDown className="size-4" aria-hidden />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-70 min-w-52 rounded-xl border border-edge bg-surface-panel p-1 shadow-popover"
              >
                <DropdownMenu.Item
                  className="touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover"
                  onSelect={openChatCreate}
                >
                  <MessageCircle className="size-4 text-fg-muted" aria-hidden />
                  {labels.createWithAssistant}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover"
                  onSelect={() => openCreate('blank')}
                >
                  <Pencil className="size-4 text-fg-muted" aria-hidden />
                  {labels.setUpManually}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    ),
    [labels.create, labels.createOptions, labels.createWithAssistant, labels.refresh, labels.setUpManually, openChatCreate, openCreate, refreshBusy, refreshNow],
  );

  useLayoutEffect(() => {
    if (embedded) return;
    setPageHeader({
      startExtra: null,
      main: <h1 className="truncate text-base font-semibold tracking-tight text-fg">{pageTitle}</h1>,
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, embedded, headerEnd, pageTitle, setPageHeader]);

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', embedded ? 'bg-transparent' : 'bg-surface-panel')}>
      <div className={cn('flex w-full flex-col gap-4', embedded ? 'py-1' : 'mx-auto max-w-[96rem] px-4 py-7 sm:px-6 lg:px-8 lg:py-9')}>
        {embedded ? (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-edge-subtle bg-surface-base px-4 py-3 shadow-surface">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-accent-fg" aria-hidden />
                <h2 className="text-sm font-semibold text-fg">{title || labels.title}</h2>
              </div>
              <p className="mt-1 text-sm leading-6 text-fg-muted">{subtitle || labels.subtitle}</p>
            </div>
            {headerEnd}
          </div>
        ) : null}
        {error || automationsSwr.error || runsSwr.error || globalAutomationsSwr.error || globalRunsSwr.error ? (
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error || labels.feedback.actionFailed}
          </div>
        ) : null}

        {activityView ? (
          initialLoading ? <AutomationsPageSkeleton /> : (
            <AutomationActivityView
              runs={ownershipRuns}
              ownership={ownership}
              labels={labels}
              language={language}
              unreadCount={ownership === 'user' ? unreadRuns.length : 0}
              loading={scopeLoading || refreshBusy}
              onOwnershipChange={setOwnership}
              onRefresh={refreshNow}
              onSelectRun={selectRun}
            />
          )
        ) : <>
        {!initialLoading ? (
          <section aria-labelledby="automation-overview-title">
            <h2 id="automation-overview-title" className="sr-only">{labels.overview.title}</h2>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge-subtle bg-edge-subtle xl:grid-cols-4">
              <OverviewMetric
                icon={<Zap className="size-4" aria-hidden />}
                label={labels.metrics.enabled}
                value={String(ownershipAutomations.filter((automation) => automation.enabled).length)}
                active={filter === 'active'}
                onClick={() => setFilter('active')}
              />
              <OverviewMetric
                icon={<Activity className="size-4" aria-hidden />}
                label={labels.metrics.running}
                value={String(runningRunCount)}
                active={filter === 'running'}
                onClick={() => setFilter('running')}
              />
              <OverviewMetric
                icon={<CircleAlert className="size-4" aria-hidden />}
                label={labels.dashboard.needsAttention}
                value={String(ownershipExecutionIssues.length)}
                tone={ownershipExecutionIssues.length > 0 ? 'danger' : 'default'}
                active={filter === 'attention'}
                onClick={() => setFilter('attention')}
              />
              <OverviewMetric
                icon={<CalendarClock className="size-4" aria-hidden />}
                label={labels.metrics.next}
                value={nextAutomation ? formatAutomationRelativeDateTime(nextAutomation.state.nextRunAtMs!, language) : '—'}
                onClick={nextAutomation ? openNextAutomation : undefined}
              />
            </div>
          </section>
        ) : null}

        {!initialLoading && hasUndismissedExecutionIssues && ownership === 'user' ? (
          <div className="flex items-center rounded-lg border border-red-500/20 bg-red-500/5">
            <button type="button" onClick={() => setFilter('attention')} className="flex min-w-0 flex-1 items-center gap-3 rounded-l-lg px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-accent">
              <CircleAlert className="size-4 shrink-0 text-red-700 dark:text-red-300" aria-hidden />
              <span className="min-w-0 text-sm text-fg"><span className="font-medium">{labels.experience.executionIssues} · {executionIssues.length}</span><span className="ml-2 text-fg-muted">{labels.experience.issuesDescription}</span></span>
            </button>
            <button
              type="button"
              onClick={dismissExecutionIssues}
              className="mr-2 rounded-md p-2 text-fg-muted hover:bg-red-500/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={labels.close}
              title={labels.close}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : null}
        {initialLoading ? (
          <AutomationsPageSkeleton />
        ) : (
          <section
            className="grid min-h-0 items-start gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]"
            aria-busy={scopeLoading}
          >
            <aside className="flex max-h-[42rem] flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-base shadow-surface xl:sticky xl:top-20 xl:max-h-[calc(100vh-7rem)]">
              <div className="shrink-0 border-b border-edge-subtle p-3">
                {!projectLocked ? (
                  <Select
                    aria-label={labels.filters.project}
                    className={inputClass}
                    value={projectIdParam}
                    onChange={(event) => selectProject(event.target.value)}
                  >
                    <SelectOption value="">{labels.filters.allProjects}</SelectOption>
                    {projects.map((project) => (
                      <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>
                    ))}
                  </Select>
                ) : null}
                <div className={cn('flex items-center gap-2', !projectLocked && 'mt-2')}>
                  <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg-muted focus-within:border-accent">
                    <Search className="size-4 shrink-0" aria-hidden />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={labels.filters.search}
                      aria-label={labels.filters.search}
                    />
                  </label>
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface-panel px-3 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                          appliedFilterCount > 0 && 'border-accent/40 bg-accent/8 text-accent-fg',
                        )}
                        aria-label={labels.filters.more}
                      >
                        <SlidersHorizontal className="size-4" aria-hidden />
                        <span>{labels.filters.more}</span>
                        {appliedFilterCount > 0 ? (
                          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] leading-5 text-on-accent">
                            {appliedFilterCount}
                          </span>
                        ) : null}
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        align="end"
                        sideOffset={6}
                        className="z-[90] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface-overlay p-3 shadow-popover outline-none"
                      >
                        <div className="text-xs font-medium text-fg-muted">{labels.filters.status}</div>
                        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={labels.filters.status}>
                          {([
                            { id: 'all' as const, label: labels.filters.all },
                            { id: 'active' as const, label: labels.filters.active },
                            { id: 'running' as const, label: labels.metrics.running },
                            { id: 'paused' as const, label: labels.paused },
                            { id: 'attention' as const, label: labels.experience.executionIssues },
                          ]).map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              className={cn(
                                'rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg',
                                filter === item.id && 'bg-surface-active text-fg',
                              )}
                              onClick={() => setFilter(item.id)}
                              aria-pressed={filter === item.id}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 border-t border-edge-subtle pt-3">
                          <div className="text-xs font-medium text-fg-muted">{labels.filters.executor}</div>
                          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={labels.filters.executor}>
                            {([
                              { id: 'all' as const, label: labels.filters.allSources, icon: Zap },
                              { id: 'agent' as const, label: labels.sources.agent, icon: Sparkles },
                              { id: 'workflow' as const, label: labels.sources.workflow, icon: GitBranch },
                              { id: 'task_command' as const, label: labels.sources.task, icon: CheckCircle2 },
                              { id: 'browser_automation' as const, label: labels.sources.browser, icon: ListTree },
                            ]).map((item) => (
                              <button
                                type="button"
                                key={item.id}
                                className={cn(
                                  'flex min-h-8 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg',
                                  sourceFilter === item.id && 'border-edge bg-surface-active text-fg',
                                )}
                                onClick={() => setSourceFilter(item.id)}
                                aria-pressed={sourceFilter === item.id}
                              >
                                <item.icon className="size-3.5" aria-hidden />
                                <span>{item.label}</span>
                                <span className="text-fg-subtle">{sourceCounts[item.id]}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        {appliedFilterCount > 0 ? (
                          <div className="mt-3 flex justify-end border-t border-edge-subtle pt-3">
                            <button type="button" className="text-xs font-medium text-accent-fg hover:underline" onClick={clearListFilters}>
                              {labels.filters.clear}
                            </button>
                          </div>
                        ) : null}
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-fg-muted">{labels.filters.ownership}</span>
                  <div className="flex rounded-lg bg-surface-panel p-0.5" role="group" aria-label={labels.filters.ownership}>
                    <button
                      type="button"
                      className={cn('rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg', ownership === 'user' && 'bg-surface-base text-fg shadow-sm')}
                      onClick={() => setOwnership('user')}
                      aria-pressed={ownership === 'user'}
                    >
                      {labels.filters.userManaged} · {userAutomations.length}
                    </button>
                    <button
                      type="button"
                      className={cn('rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg', ownership === 'system' && 'bg-surface-base text-fg shadow-sm')}
                      onClick={() => setOwnership('system')}
                      aria-pressed={ownership === 'system'}
                    >
                      {labels.system.title} · {systemAutomations.length}
                    </button>
                  </div>
                </div>
                {unreadRuns.length > 0 && ownership === 'user' ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-accent/8 px-2.5 py-1.5 text-xs text-accent-fg">
                    <span>{labels.filters.unread} · {unreadRuns.length}</span>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      disabled={busyAction === 'runs:read-all'}
                      onClick={() => void markAllRead()}
                    >
                      {labels.filters.markAllRead}
                    </button>
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1.5">
                    {scopeLoading ? <RefreshCw className="size-3 animate-spin" aria-hidden /> : null}
                    {scopeLoading ? labels.loading : labels.filters.results.replace('{count}', String(filteredAutomations.length))}
                  </span>
                  {filter !== 'all' || sourceFilter !== 'all' || normalizedSearch ? (
                    <button type="button" className="font-medium text-accent-fg hover:underline" onClick={clearListFilters}>
                      {labels.filters.clear}
                    </button>
                  ) : null}
                </div>
              </div>
              <AutomationList
                automations={filteredAutomations}
                runs={ownershipRuns}
                labels={labels}
                cronLabels={cronLabels}
                language={language}
                selectedAutomationId={selectedAutomationId}
                onOpenDetails={openAutomationDetails}
              />
            </aside>
            {selectedAutomation ? (
              <AutomationDetails
                key={selectedAutomation.id}
                automation={selectedAutomation}
                runs={selectedAutomationRuns}
                runsLoading={selectedRunsSwr.isLoading}
                runsError={selectedRunsSwr.error ? labels.feedback.actionFailed : undefined}
                labels={labels}
                cronLabels={cronLabels}
                language={language}
                projects={projects}
                busyAction={busyAction}
                onEdit={openAutomationEditor}
                onSelectRun={selectRun}
                onAction={mutateAutomation}
              />
            ) : (
              <div className="min-h-[28rem] overflow-hidden rounded-xl border border-edge-subtle bg-surface-base shadow-surface">
                {ownership === 'user' && ownershipAutomations.length === 0 ? (
                  <div className="p-5">
                    <h2 className="text-sm font-semibold text-fg">{labels.experience.scenes}</h2>
                    <p className="mt-1 text-sm text-fg-muted">{labels.experience.scenesDescription}</p>
                    <ScenarioCards templates={templates} labels={labels} onSelect={selectTemplate} />
                    <Button className="mt-4" variant="ghost" onClick={() => openCreate('draft')}>{labels.experience.custom}</Button>
                  </div>
                ) : (
                  <>
                    <EmptyState
                      className="min-h-56 rounded-none border-0 shadow-none"
                      icon={<Zap className="size-5" />}
                      title={ownershipAutomations.length === 0 ? labels.empty.automations : labels.empty.filtered}
                    />
                    {ownershipAutomations.length > 0 ? (
                      <div className="flex justify-center border-t border-edge-subtle p-4">
                        <Button variant="ghost" onClick={clearListFilters}>{labels.filters.clear}</Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </section>
        )}
        {!initialLoading && userAutomations.length > 0 ? <div><Button variant="ghost" onClick={() => openCreate('draft')}><Plus className="size-4" aria-hidden />{labels.experience.discover}</Button></div> : null}
        </>}
      </div>

      <Dialog.Root
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setEditingAutomationId(null);
            setEditingDraft(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-66 flex h-[min(760px,calc(100vh-2rem))] w-[min(100%-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
            <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-fg">
                  {createMode === 'draft'
                    ? labels.draft.title
                    : editingAutomation
                      ? labels.editTitle
                      : editingDraft
                        ? labels.draft.editTitle
                        : labels.createTitle}
                </Dialog.Title>
                <p className="mt-1 text-xs text-fg-muted">
                  {createMode === 'draft' ? labels.draft.subtitle : labels.form.createFlowHint}
                </p>
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" aria-label={labels.close}>
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
            {error ? <p role="alert" className="px-5 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
            {createMode === 'draft' ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <DraftPanel
                  labels={labels}
                  prompt={draftPrompt}
                  draft={draft}
                  loading={draftLoading}
                  approved={draftApproved}
                  publishBusy={busyAction === 'draft:publish'}
                  testBusy={busyAction === 'draft:test'}
                  templates={templates}
                  projects={projects}
                  projectId={draftProjectId}
                  conversationMode={draftConversationMode}
                  notificationPolicy={draftNotificationPolicy}
                  onPromptChange={setDraftPrompt}
                  onGenerate={generateDraft}
                  onEdit={openDraftEditor}
                  onPublish={publishDraft}
                  onTest={testDraft}
                  onProjectChange={setDraftProjectId}
                  onConversationModeChange={setDraftConversationMode}
                  onNotificationPolicyChange={setDraftNotificationPolicy}
                  projectLocked={projectLocked}
                  onApprovedChange={setDraftApproved}
                  onDiscard={() => {
                    setDraft(null);
                    setDraftApproved(false);
                  }}
                  onTemplateSelect={(template) => {
                    selectTemplate(template);
                    setForm({ ...template.form, projectId: draftProjectId });
                  }}
                  onOpenAdvanced={() => {
                    setForm({
                      ...initialForm,
                      projectId: draftProjectId,
                      conversationMode: draftConversationMode,
                      notificationPolicy: draftNotificationPolicy,
                    });
                    setCreateMode('blank');
                  }}
                />
              </div>
            ) : (
              <>
                {managedTriggerEdit ? <ManagedScheduleForm form={form} setForm={setForm} labels={labels} /> : createMode === 'quick' && quickTemplate ? <AutomationQuickCreate form={form} setForm={setForm} labels={labels} projects={projects} projectLocked={projectLocked} source={quickTemplate.source} requiresProject={quickTemplate.requiresProject} /> : <AutomationForm
                  form={form}
                  labels={labels}
                  setForm={setForm}
                  projects={projects}
                  workflowDefinitions={workflowDefinitions}
                  selectedWorkflow={selectedWorkflow}
                  workflowsLoading={workflowDefinitionsSwr.isLoading}
                  browserAutomations={browserAutomations}
                  selectedBrowserAutomation={selectedBrowserAutomation}
                  browserAutomationsLoading={browserAutomationsSwr.isLoading}
                  agentOptions={agentOptions}
                  agentsLoading={chatAgentsSwr.isLoading}
                  defaultAgentId={chatAgentsSwr.data?.defaultId ?? ''}
                  taskOptions={taskOptions}
                  tasksLoading={tasksSwr.isLoading}
                  language={language}
                  projectLocked={projectLocked}
                />}
                <div className="flex flex-wrap justify-end gap-2 border-t border-edge px-5 py-4">
                  {createMode === 'quick' ? <Button variant="ghost" onClick={() => setCreateMode('blank')}>{labels.draft.advancedCreate}</Button> : null}
                  {editingDraft ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingDraft(false);
                        setCreateMode('draft');
                      }}
                    >
                      {labels.cancel}
                    </Button>
                  ) : (
                    <Dialog.Close asChild>
                      <Button variant="ghost">{labels.cancel}</Button>
                    </Dialog.Close>
                  )}
                  <Button
                    variant="primary"
                    onClick={submitForm}
                    disabled={!formCanSubmit || Boolean(busyAction) || (createMode === 'quick' && Boolean(quickTemplate?.requiresProject) && !form.projectId)}
                  >
                    {busyAction === 'automation:create' || busyAction === 'draft:edit' || (editingAutomation && busyAction === `automation:${editingAutomation.id}:edit`)
                      ? labels.feedback.working
                      : editingAutomation || editingDraft
                        ? labels.save
                        : labels.experience.createEnabled}
                  </Button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={runDetailOpen && Boolean(selectedRun)}
        onOpenChange={(open) => {
          setRunDetailOpen(open);
          if (open) return;
          setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            next.delete('run');
            return next;
          }, { replace: true });
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-66 flex h-[min(85vh,40rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
            <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
              <Dialog.Title className="truncate text-base font-semibold text-fg">
                {selectedRun?.automationName ?? labels.dashboard.result}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" aria-label={labels.close}>
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <RunDiagnosticsPanel
                className="rounded-none border-0"
                run={selectedRun}
                events={runEvents}
                labels={labels}
                cronLabels={cronLabels}
                language={language}
                loading={runEventsSwr.isLoading}
                repairDraft={repairDraft}
                repairLoading={repairLoading}
                repairApproved={repairApproved}
                busyAction={busyAction}
                onRepairApprovedChange={setRepairApproved}
                onSuggestRepair={generateRepairDraft}
                onApplyRepair={applyRepairDraft}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function ScenarioCards({ templates, labels, onSelect }: { templates: AutomationTemplate[]; labels: AutomationsMessages; onSelect: (template: AutomationTemplate) => void }) {
  return <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{templates.map((template) => (
    <button type="button" key={template.name} onClick={() => onSelect(template)} className="rounded-lg border border-edge-subtle bg-surface-panel p-4 text-left hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent">
      <CalendarClock className="mb-3 size-4 text-accent-fg" aria-hidden />
      <div className="text-sm font-medium text-fg">{template.name}</div>
      <p className="mt-1 text-sm text-fg-muted">{template.description}</p>
      <p className="mt-3 text-xs text-fg-muted">{labels.experience.source}: {template.source}</p>
    </button>
  ))}</div>;
}

function ManagedScheduleForm({
  form,
  setForm,
  labels,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  labels: AutomationsMessages;
}) {
  const update = (patch: Partial<FormState>) => setForm(previous => ({ ...previous, ...patch }));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <Section step="1" title={labels.form.trigger} description={labels.form.triggerStepDescription} />
      <Select className={inputClass} value={form.triggerMode} onChange={(event) => update({ triggerMode: event.target.value as TriggerMode })}>
        <SelectOption value="daily">{labels.trigger.daily}</SelectOption>
        <SelectOption value="weekly">{labels.trigger.weekly}</SelectOption>
        <SelectOption value="interval">{labels.trigger.interval}</SelectOption>
        <SelectOption value="cron">{labels.trigger.customCron}</SelectOption>
      </Select>
      {form.triggerMode === 'daily' || form.triggerMode === 'weekly' ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={labels.form.time}><TimePicker value={form.time} onChange={(time) => update({ time })} ariaLabel={labels.form.time} /></Field>
          {form.triggerMode === 'weekly' ? (
            <Field label={labels.form.day}>
              <Select className={inputClass} value={form.weekday} onChange={(event) => update({ weekday: event.target.value })}>
                <SelectOption value="1">{labels.weekdays.monday}</SelectOption>
                <SelectOption value="2">{labels.weekdays.tuesday}</SelectOption>
                <SelectOption value="3">{labels.weekdays.wednesday}</SelectOption>
                <SelectOption value="4">{labels.weekdays.thursday}</SelectOption>
                <SelectOption value="5">{labels.weekdays.friday}</SelectOption>
                <SelectOption value="6">{labels.weekdays.saturday}</SelectOption>
                <SelectOption value="0">{labels.weekdays.sunday}</SelectOption>
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}
      {form.triggerMode === 'interval' ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label={labels.form.intervalEvery}>
            <input className={inputClass} type="number" min="1" value={form.intervalValue} onChange={(event) => update({ intervalValue: event.target.value })} />
          </Field>
          <Field label={labels.form.intervalUnits.minute}>
            <Select className={inputClass} value={form.intervalUnit} onChange={(event) => update({ intervalUnit: event.target.value as AutomationIntervalUnit })}>
              <SelectOption value="minute">{labels.form.intervalUnits.minute}</SelectOption>
              <SelectOption value="hour">{labels.form.intervalUnits.hour}</SelectOption>
              <SelectOption value="day">{labels.form.intervalUnits.day}</SelectOption>
              <SelectOption value="week">{labels.form.intervalUnits.week}</SelectOption>
            </Select>
          </Field>
        </div>
      ) : null}
      {form.triggerMode === 'cron' ? (
        <div className="mt-4"><Field label={labels.form.expression}><input className={inputClass} value={form.cronExpr} onChange={(event) => update({ cronExpr: event.target.value })} /></Field></div>
      ) : null}
    </div>
  );
}

function DraftPanel({
  labels,
  prompt,
  draft,
  loading,
  approved,
  publishBusy = false,
  testBusy = false,
  templates,
  projects,
  projectId,
  conversationMode,
  notificationPolicy,
  onPromptChange,
  onGenerate,
  onEdit,
  onPublish,
  onTest,
  onProjectChange,
  onConversationModeChange,
  onNotificationPolicyChange,
  onApprovedChange,
  onDiscard,
  onTemplateSelect,
  onOpenAdvanced,
  projectLocked = false,
}: {
  labels: AutomationsMessages;
  prompt: string;
  draft: AutomationDraft | null;
  loading: boolean;
  approved: boolean;
  publishBusy?: boolean;
  testBusy?: boolean;
  templates: AutomationTemplate[];
  projects: Project[];
  projectId: string;
  conversationMode: AutomationConversationMode;
  notificationPolicy: AutomationNotificationPolicy;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onEdit: () => void;
  onPublish: () => void;
  onTest: () => void;
  onProjectChange: (value: string) => void;
  onConversationModeChange: (value: AutomationConversationMode) => void;
  onNotificationPolicyChange: (value: AutomationNotificationPolicy) => void;
  onApprovedChange: (value: boolean) => void;
  onDiscard: () => void;
  onTemplateSelect: (template: AutomationTemplate) => void;
  onOpenAdvanced: () => void;
  projectLocked?: boolean;
}) {
  const requiresApproval = Boolean(draft && draft.simulation.requiredConfirmations.length > 0);
  return (
    <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
      {!draft ? (
        <div className="mb-5 border-b border-edge-subtle pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-fg">{labels.draft.suggestions}</div>
              <div className="mt-1 text-xs text-fg-muted">{labels.draft.suggestionsDescription}</div>
            </div>
            <Button variant="ghost" onClick={onOpenAdvanced}>{labels.draft.advancedCreate}</Button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {templates.map((template) => (
              <button
                type="button"
                key={template.name}
                className="focus-visible:ring-2 focus-visible:ring-accent rounded-lg border border-edge-subtle bg-surface-panel p-3 text-left hover:bg-surface-hover"
                onClick={() => onTemplateSelect(template)}
              >
                <div className="text-sm font-medium text-fg">{template.name}</div>
                <div className="mt-1 line-clamp-2 text-xs text-fg-muted">{template.description}</div>
                <div className="mt-2 text-xs text-fg-muted">{labels.experience.source}: {template.source}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Sparkles className="size-4 text-accent" />
            {labels.draft.title}
          </div>
          <div className="mt-1 text-sm text-fg-muted">{labels.draft.subtitle}</div>
        </div>
        <Button variant="primary" onClick={onGenerate} disabled={loading || !prompt.trim()}>
          <Sparkles className="size-4" />
          {loading ? labels.draft.generating : labels.draft.generate}
        </Button>
      </div>
      <textarea
        aria-label={labels.draft.title}
        className="mt-4 min-h-20 w-full resize-y rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder={labels.draft.placeholder}
      />
      <div className={cn('mt-3 grid gap-3', projectLocked ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        {!projectLocked ? (
          <Field label={labels.draft.project}>
            <Select className={inputClass} value={projectId} onChange={(event) => onProjectChange(event.target.value)}>
              <SelectOption value="">{labels.draft.noProject}</SelectOption>
              {projects.map((project) => <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>)}
            </Select>
          </Field>
        ) : null}
        <Field label={labels.draft.conversation}>
          <Select className={inputClass} value={conversationMode} onChange={(event) => onConversationModeChange(event.target.value as AutomationConversationMode)}>
            <SelectOption value="new_session">{labels.draft.newConversation}</SelectOption>
            <SelectOption value="continuous">{labels.draft.continuousConversation}</SelectOption>
          </Select>
        </Field>
        <Field label={labels.draft.notifications}>
          <Select className={inputClass} value={notificationPolicy} onChange={(event) => onNotificationPolicyChange(event.target.value as AutomationNotificationPolicy)}>
            <SelectOption value="attention">{labels.draft.notifyAttention}</SelectOption>
            <SelectOption value="all">{labels.draft.notifyAll}</SelectOption>
            <SelectOption value="none">{labels.draft.notifyNone}</SelectOption>
          </Select>
        </Field>
      </div>
      {draft ? (
        <div className="mt-4 grid gap-3 rounded-lg bg-surface-base p-4 lg:grid-cols-[1fr_1fr]">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg">{draft.automation.name}</div>
            {draft.automation.description ? (
              <div className="mt-1 text-sm text-fg-muted">{draft.automation.description}</div>
            ) : null}
            <div className="mt-3 grid gap-2 text-sm">
              <Info label={labels.info.when} value={draft.simulation.triggerSummary} />
              <Info label={labels.info.run} value={draft.simulation.actionSummary} />
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase text-fg-muted">{labels.draft.review}</div>
            <ReviewList
              title={labels.draft.safety}
              items={[...draft.simulation.safetyNotes, ...draft.simulation.requiredConfirmations]}
              empty={labels.none}
            />
            <ReviewList title={labels.draft.assumptions} items={draft.assumptions} empty={labels.none} />
            <ReviewList title={labels.draft.risks} items={draft.risks} empty={labels.none} />
            {requiresApproval ? (
              <label className="mt-4 flex items-start gap-2 text-sm text-fg">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={approved}
                  onChange={(event) => onApprovedChange(event.target.checked)}
                />
                <span>{labels.draft.approval}</span>
              </label>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onDiscard}>{labels.draft.discard}</Button>
              <Button variant="secondary" onClick={onEdit}>
                <Pencil className="size-4" />
                {labels.draft.edit}
              </Button>
              <Button variant="secondary" onClick={onTest} disabled={testBusy || publishBusy || (requiresApproval && !approved)}>
                <Play className="size-4" />
                {testBusy ? labels.draft.testing : labels.draft.testOnce}
              </Button>
              <Button variant="primary" onClick={onPublish} disabled={publishBusy || (requiresApproval && !approved)}>
                {publishBusy ? labels.feedback.working : labels.draft.publish}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReviewList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-fg-muted">{title}</div>
      <ul className="mt-1 space-y-1 text-sm text-fg">
        {items.length > 0 ? items.map((item) => <li key={item}>- {item}</li>) : <li className="text-fg-muted">{empty}</li>}
      </ul>
    </div>
  );
}

function OverviewMetric({
  icon,
  label,
  value,
  tone = 'default',
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'danger';
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={cn('shrink-0', tone === 'danger' ? 'text-red-600 dark:text-red-300' : 'text-fg-subtle')}>{icon}</span>
      <span className="truncate text-xs font-medium text-fg-muted">{label}</span>
      <span className={cn('ml-auto truncate text-sm font-semibold tabular-nums', tone === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-fg')}>{value}</span>
    </>
  );
  const className = cn(
    'flex min-h-12 min-w-0 items-center gap-2.5 bg-surface-base px-3 py-2.5 text-left transition-colors',
    active && 'bg-accent/8',
    onClick && 'cursor-pointer hover:bg-surface-hover focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
  );
  const accessibleLabel = `${label}: ${value}`;
  return onClick
    ? <button type="button" className={className} onClick={onClick} aria-label={accessibleLabel} aria-pressed={active}>{content}</button>
    : <div className={className} aria-label={accessibleLabel}>{content}</div>;
}

function AutomationActivityView({
  runs,
  ownership,
  labels,
  language,
  unreadCount,
  loading,
  onOwnershipChange,
  onRefresh,
  onSelectRun,
}: {
  runs: AutomationRun[];
  ownership: AutomationOwnership;
  labels: AutomationsMessages;
  language: StoredLanguage;
  unreadCount: number;
  loading: boolean;
  onOwnershipChange: (ownership: AutomationOwnership) => void;
  onRefresh: () => void;
  onSelectRun: (runId: string) => void;
}) {
  const runningCount = runs.filter(isActiveRun).length;
  const attentionCount = runs.filter(needsAttention).length;
  return (
    <section className="overflow-hidden rounded-xl border border-edge-subtle bg-surface-base shadow-surface" aria-labelledby="automation-activity-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge-subtle px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="automation-activity-title" className="text-sm font-semibold text-fg">{labels.dashboard.activity}</h2>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{labels.dashboard.activityDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surface-panel p-0.5" role="group" aria-label={labels.filters.ownership}>
            <button
              type="button"
              className={cn('rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg', ownership === 'user' && 'bg-surface-base text-fg shadow-sm')}
              onClick={() => onOwnershipChange('user')}
              aria-pressed={ownership === 'user'}
            >
              {labels.filters.userManaged}
            </button>
            <button
              type="button"
              className={cn('rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-fg', ownership === 'system' && 'bg-surface-base text-fg shadow-sm')}
              onClick={() => onOwnershipChange('system')}
              aria-pressed={ownership === 'system'}
            >
              {labels.system.title}
            </button>
          </div>
          <RefreshButton className="size-9 shrink-0 p-0" loading={loading} label={labels.refresh} onClick={onRefresh} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px border-b border-edge-subtle bg-edge-subtle lg:grid-cols-4">
        <OverviewMetric icon={<Activity className="size-4" aria-hidden />} label={labels.metrics.total} value={String(runs.length)} />
        <OverviewMetric icon={<Play className="size-4" aria-hidden />} label={labels.metrics.running} value={String(runningCount)} />
        <OverviewMetric icon={<CircleAlert className="size-4" aria-hidden />} label={labels.dashboard.needsAttention} value={String(attentionCount)} tone={attentionCount > 0 ? 'danger' : 'default'} />
        <OverviewMetric icon={<CheckCircle2 className="size-4" aria-hidden />} label={labels.filters.unread} value={String(unreadCount)} />
      </div>
      {runs.length === 0 ? (
        <EmptyState className="min-h-64 rounded-none border-0 shadow-none" icon={<Activity className="size-5" />} title={labels.empty.runs} />
      ) : (
        <div className="divide-y divide-edge-subtle">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5"
              onClick={() => onSelectRun(run.id)}
            >
              <span className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                isActiveRun(run) ? 'bg-blue-500' : needsAttention(run) ? 'bg-red-500' : 'bg-emerald-500',
              )} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">{run.automationName}</span>
                  {run.readAtMs == null && !isActiveRun(run) ? <span className="size-2 shrink-0 rounded-full bg-blue-500"><span className="sr-only">{labels.filters.unread}</span></span> : null}
                </span>
                <span className={cn('mt-1 line-clamp-2 block text-sm text-fg-muted', run.error && 'text-red-700 dark:text-red-300')}>
                  {run.error || run.summary || labels.status[run.status]}
                </span>
                <span className="mt-1 block text-xs text-fg-subtle">{formatDate(run.createdAtMs, labels, language)}</span>
              </span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', statusClass(run.status))}>
                {labels.status[run.status]}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AutomationList({
  automations,
  runs,
  labels,
  cronLabels,
  language,
  selectedAutomationId,
  onOpenDetails,
}: {
  automations: Automation[];
  runs: AutomationRun[];
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  selectedAutomationId: string | null;
  onOpenDetails: (automationId: string) => void;
}) {
  if (automations.length === 0) {
    return (
      <EmptyState
        className="rounded-none border-0 shadow-none"
        icon={<Zap className="size-5" />}
        title={labels.empty.filtered}
      />
    );
  }
  return (
    <div className="min-h-0 overflow-y-auto divide-y divide-edge-subtle">
      {automations.map((automation) => {
        const recentRuns = runs
          .filter((run) => run.automationId === automation.id)
          .sort((a, b) => b.createdAtMs - a.createdAtMs);
        const activeRun = recentRuns.find(isActiveRun);
        const latestRunForAutomation = recentRuns[0];
        return (
          <button
            type="button"
            key={automation.id}
            className={cn(
              'block w-full p-3 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
              selectedAutomationId === automation.id && 'bg-surface-hover',
            )}
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 130px' }}
            aria-current={selectedAutomationId === automation.id ? 'true' : undefined}
            onClick={() => onOpenDetails(automation.id)}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn(
                'size-2 shrink-0 rounded-full',
                activeRun
                  ? 'bg-blue-500'
                  : automationHasExecutionIssue(automation, recentRuns)
                    ? 'bg-red-500'
                    : automation.enabled
                      ? 'bg-emerald-500'
                      : 'bg-fg-subtle',
              )} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{automation.name}</span>
              <span className="shrink-0 text-xs text-fg-muted">{automation.enabled ? labels.enabled : labels.paused}</span>
              {latestRunForAutomation && latestRunForAutomation.readAtMs == null && !isActiveRun(latestRunForAutomation) ? (
                <span className="ml-auto size-2 shrink-0 rounded-full bg-blue-500">
                  <span className="sr-only">{labels.filters.unread}</span>
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 pl-4 text-xs">
              <span className="inline-flex items-center gap-1 rounded-md border border-edge-subtle bg-surface-panel px-1.5 py-0.5 text-fg-muted">
                <AutomationSourceIcon kind={automation.action.kind} className="size-3" />
                {actionKindLabel(automation.action, labels)}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-surface-panel px-1.5 py-0.5 text-fg-muted">
                <CalendarClock className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{automationTriggerLabel(automation.trigger, labels, cronLabels, language)}</span>
              </span>
            </div>
            <div className="mt-2 flex min-w-0 items-center justify-between gap-2 pl-4 text-xs text-fg-subtle">
              <span className={cn('line-clamp-2', latestRunForAutomation?.error && 'text-red-700 dark:text-red-300')}>
                {latestRunForAutomation
                  ? latestRunForAutomation.error || latestRunForAutomation.summary || labels.status[latestRunForAutomation.status]
                  : automation.state.lastError || (automation.state.lastRunStatus ? labels.status[automation.state.lastRunStatus] : labels.experience.noRuns)}
              </span>
              {latestRunForAutomation?.status ? (
                <span className={cn('shrink-0 rounded-full px-1.5 py-0.5', statusClass(latestRunForAutomation.status))}>
                  {labels.status[latestRunForAutomation.status]}
                </span>
              ) : null}
            </div>
            <div className="mt-2 space-y-1 pl-4 text-xs text-fg-muted">
              {latestRunForAutomation ? <div>{labels.last}: {formatDate(latestRunForAutomation.createdAtMs, labels, language)}</div> : null}
              <div>{automation.enabled ? `${labels.next}: ${automationNextRunLabel(automation, labels, language)}` : labels.paused}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function runEventLabel(event: AutomationRunEvent, labels: AutomationsMessages): string {
  const eventLabels: RunEventLabels = labels.events;
  const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
  const actionKind = typeof data.actionKind === 'string' ? data.actionKind : null;
  const status = typeof data.status === 'string' && data.status in labels.status
    ? labels.status[data.status as keyof typeof labels.status]
    : null;

  switch (event.type) {
    case 'run.queued':
      if (event.message.toLowerCase().includes('manual')) return eventLabels.manualQueued;
      if (event.message.toLowerCase().includes('scheduled')) return eventLabels.scheduledQueued;
      return eventLabels.eventQueued;
    case 'run.started':
      return eventLabels.runStarted;
    case 'action.started':
      return actionKind ? eventLabels.actionStarted.replace('{kind}', actionKind) : eventLabels.actionStartedFallback;
    case 'action.completed':
      return actionKind ? eventLabels.actionCompleted.replace('{kind}', actionKind) : eventLabels.actionCompletedFallback;
    case 'action.failed':
      return actionKind ? eventLabels.actionFailed.replace('{kind}', actionKind) : eventLabels.actionFailedFallback;
    case 'completion_hook.started':
      return eventLabels.completionHookStarted;
    case 'completion_hook.completed':
      return eventLabels.completionHookCompleted;
    case 'completion_hook.failed':
      return eventLabels.completionHookFailed;
    case 'run.completed':
      return status ? eventLabels.runCompleted.replace('{status}', status) : eventLabels.runCompletedFallback;
    default:
      return event.message;
  }
}

function JsonDetails({
  value,
  labels,
  title,
  defaultExpanded = false,
}: {
  value: unknown;
  labels: AutomationsMessages;
  title: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const lineCount = useMemo(() => json.split('\n').length, [json]);
  const isLong = json.length > 720 || lineCount > 18;
  const preview = isLong ? `${json.split('\n').slice(0, 10).join('\n').trimEnd()}...` : json;

  return (
    <div className="mt-2 rounded-md border border-edge/70 bg-surface-inset/35">
      {isLong ? (
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left text-xs font-medium text-fg-muted hover:bg-surface-hover hover:text-fg"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span>{title}</span>
          <span className="inline-flex items-center gap-1 text-accent-fg">
            {expanded ? labels.details.hideDetails : labels.details.showDetails}
            <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden />
          </span>
        </button>
      ) : (
        <div className="px-2.5 py-2 text-xs font-medium text-fg-muted">{title}</div>
      )}
      <pre className="whitespace-pre-wrap break-all px-2.5 pb-2 text-xs leading-relaxed text-fg-muted">
        {expanded || !isLong ? json : preview}
      </pre>
    </div>
  );
}

function RunDiagnosticsPanel({
  className,
  run,
  events,
  labels,
  cronLabels,
  language,
  loading,
  repairDraft,
  repairLoading,
  repairApproved,
  busyAction,
  onRepairApprovedChange,
  onSuggestRepair,
  onApplyRepair,
}: {
  className?: string;
  run: AutomationRun | null;
  events: AutomationRunEvent[];
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  loading: boolean;
  repairDraft: AutomationRepairDraft | null;
  repairLoading: boolean;
  repairApproved: boolean;
  busyAction: string | null;
  onRepairApprovedChange: (value: boolean) => void;
  onSuggestRepair: (run: AutomationRun) => void;
  onApplyRepair: (run: AutomationRun) => void;
}) {
  if (!run) {
    return (
      <aside className={cn('flex min-h-64 flex-col justify-center rounded-lg border border-edge-subtle bg-surface-base px-4 text-center text-sm text-fg-muted shadow-surface', className)}>
        <Activity className="mx-auto size-5" />
        <div className="mt-2">{labels.selectRun}</div>
      </aside>
    );
  }

  const result = run.error || run.summary;
  const processLink = run.conversationId
    ? `/chat/${encodeURIComponent(run.conversationId)}`
    : run.workflowRunId
      ? `/workflows?run=${encodeURIComponent(run.workflowRunId)}`
      : null;
  const processLabel = run.conversationId ? labels.runDetail.openConversation : labels.runDetail.openWorkflow;
  const ProcessIcon = run.conversationId ? MessageCircle : GitBranch;
  const ResultIcon = isActiveRun(run) ? Activity : run.status === 'succeeded' ? CheckCircle2 : CircleAlert;

  return (
    <aside className={cn('rounded-lg border border-edge-subtle bg-surface-base shadow-surface', className)}>
      <div className="border-b border-edge px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">{run.automationName}</div>
            <div className="mt-1 text-xs text-fg-muted">{run.id.slice(0, 8)}</div>
          </div>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', statusClass(run.status))}>
            {labels.status[run.status]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span>{formatDate(run.createdAtMs, labels, language)}</span>
          <span aria-hidden>·</span>
          <span>{labels.details.duration} {formatDuration(run.durationMs, labels)}</span>
        </div>
        {run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled' ? (
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={() => onSuggestRepair(run)} disabled={repairLoading}>
              <Sparkles className="size-4" />
              {repairLoading ? labels.repair.generating : labels.repair.suggest}
            </Button>
          </div>
        ) : null}
      </div>

      <section className="border-b border-edge p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <ResultIcon className={cn(
              'size-4',
              isActiveRun(run) ? 'text-blue-500' : needsAttention(run) ? 'text-red-500' : run.status === 'succeeded' ? 'text-emerald-500' : 'text-fg-muted',
            )} />
            {labels.runDetail.resultTitle}
          </div>
          {processLink ? (
            <Button asChild variant="secondary" className="h-8 rounded-md px-2.5 text-xs">
              <Link to={processLink}>
                <ProcessIcon className="size-3.5" />
                {processLabel}
                <ChevronRight className="size-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>
        <div className={cn(
          'mt-3 max-h-80 overflow-y-auto rounded-lg border border-edge/70 bg-surface-inset/25 p-3',
          run.error && 'border-red-500/25 bg-red-500/5',
        )}>
          {result ? (
            run.error ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-red-700 dark:text-red-300">{result}</p>
            ) : (
              <MarkdownView content={result} compact className="text-sm" />
            )
          ) : (
            <p className="text-sm leading-relaxed text-fg-muted">
              {isActiveRun(run) ? labels.runDetail.resultPending : labels.runDetail.noResult}
            </p>
          )}
        </div>
      </section>

      <section className="border-b border-edge p-4">
        <div className="text-xs font-semibold uppercase text-fg-muted">{labels.runDetail.runInfo}</div>
        <div className="mt-3 grid gap-2 text-xs text-fg-muted">
          <DetailLine
            label={labels.explain.whyRan}
            value={run.manual ? labels.trigger.manual : automationTriggerLabel(run.triggerSnapshot, labels, cronLabels, language)}
          />
          <DetailLine label={labels.details.started} value={formatDate(run.startedAtMs, labels, language)} />
          {run.model ? <DetailLine label={labels.details.model} value={run.model} /> : null}
        </div>
      </section>

      {repairDraft ? (
        <div className="border-b border-edge px-4 py-3">
          <div className="text-xs font-semibold uppercase text-fg-muted">{labels.repair.title}</div>
          <div className="mt-2 text-sm text-fg">{repairDraft.explanation}</div>
          {repairDraft.expectedEffect ? (
            <div className="mt-2 text-sm text-fg-muted">{repairDraft.expectedEffect}</div>
          ) : null}
          <ReviewList title={labels.repair.risks} items={repairDraft.risks} empty={labels.none} />
          <JsonDetails value={repairDraft.patch} labels={labels} title={labels.details.repairPatch} />
          {repairDraft.requiresApproval ? (
            <label className="mt-3 flex items-start gap-2 text-sm text-fg">
              <input
                className="mt-1"
                type="checkbox"
                checked={repairApproved}
                onChange={(event) => onRepairApprovedChange(event.target.checked)}
              />
              <span>{labels.repair.approval}</span>
            </label>
          ) : null}
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              onClick={() => onApplyRepair(run)}
              disabled={busyAction === `run:${run.id}:repair` || (repairDraft.requiresApproval && !repairApproved)}
            >
              {busyAction === `run:${run.id}:repair` ? labels.feedback.working : labels.repair.apply}
            </Button>
          </div>
        </div>
      ) : null}

      <details className="group px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg-muted">
            <ListTree className="size-4 shrink-0" />
            {labels.runDetail.technicalEvents}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
            {labels.runDetail.eventCount.replace('{count}', String(events.length))}
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{labels.runDetail.technicalEventsDescription}</p>
        <div className="mt-4">
          {loading ? (
            <div className="space-y-3" aria-label={labels.loading}>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-4/5" />
              <Skeleton className="h-10 w-11/12" />
            </div>
          ) : events.length === 0 ? (
            <div className="text-sm text-fg-muted">{labels.empty.events}</div>
          ) : (
            <ol className="space-y-3">
              {events.map((event) => (
                <li key={event.id} className="grid grid-cols-[0.75rem_1fr] gap-3">
                  <span className={cn('mt-1 size-2 rounded-full', eventTone(event.type))} />
                  <div className="min-w-0">
                    <div className="text-sm text-fg">{runEventLabel(event, labels)}</div>
                    <div className="mt-1 text-xs text-fg-muted">
                      {formatDate(event.createdAtMs, labels, language)} · {event.type}
                    </div>
                    {event.data && typeof event.data === 'object' ? (
                      <details className="group/event mt-2 rounded-md border border-edge/70 bg-surface-inset/35">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs font-medium text-fg-muted outline-none hover:text-fg">
                          {labels.details.eventData}
                          <ChevronDown className="size-3.5 transition-transform group-open/event:rotate-180" />
                        </summary>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-t border-edge/70 px-2.5 py-2 text-xs leading-relaxed text-fg-muted">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>
    </aside>
  );
}

function AutomationDetails({
  automation,
  runs,
  runsLoading,
  runsError,
  labels,
  cronLabels,
  language,
  projects,
  busyAction,
  onEdit,
  onSelectRun,
  onAction,
}: {
  automation: Automation;
  runs: AutomationRun[];
  runsLoading: boolean;
  runsError?: string;
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  projects: Project[];
  busyAction: string | null;
  onEdit: (automation: Automation) => void;
  onSelectRun: (runId: string) => void;
  onAction: (actionKey: string, action: () => Promise<unknown>, successTitle?: string) => Promise<boolean>;
}) {
  const runBusy = busyAction === `automation:${automation.id}:run`;
  const toggleBusy = busyAction === `automation:${automation.id}:toggle`;
  const deleteBusy = busyAction === `automation:${automation.id}:delete`;
  const canToggle = !automation.management || automation.management.editable.includes('enabled');
  const canRun = !automation.management || automation.management.runnable;
  const canEdit = !automation.management || automation.management.editable.includes('trigger');
  const canDelete = !automation.management || automation.management.deletable;

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel shadow-surface">
      <header className="flex flex-col items-start gap-3 border-b border-edge px-5 py-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-fg">{automation.name}</h2>
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-xs',
              automation.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-surface-hover text-fg-muted',
            )}>
              {automation.enabled ? labels.enabled : labels.paused}
            </span>
          </div>
          {visibleAutomationDescription(automation) ? (
            <p className="mt-1 text-sm text-fg-muted">{visibleAutomationDescription(automation)}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-edge-subtle bg-surface-base px-2 py-1">
              <AutomationSourceIcon kind={automation.action.kind} className="size-3.5" />
              {actionKindLabel(automation.action, labels)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-edge-subtle bg-surface-base px-2 py-1">
              <CalendarClock className="size-3.5" aria-hidden />
              {automationTriggerLabel(automation.trigger, labels, cronLabels, language)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-edge-subtle bg-surface-base px-2 py-1">
              <GitBranch className="size-3.5" aria-hidden />
              {projects.find((project) => project.id === automation.projectId)?.name ?? labels.info.noProject}
            </span>
          </div>
        </div>
        {canToggle || canRun || canEdit || canDelete ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            {canToggle ? <Button
              variant="secondary"
              disabled={busyAction !== null}
              onClick={() => void onAction(
                `automation:${automation.id}:toggle`,
                () => automation.enabled ? automationApi.pause(automation.id) : automationApi.resume(automation.id),
                automation.enabled ? labels.feedback.paused : labels.dashboard.resumed,
              )}
            >
              {toggleBusy ? <RefreshCw className="size-4 animate-spin" /> : automation.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
              {automation.enabled ? labels.dashboard.pause : labels.dashboard.resume}
            </Button> : null}
            {canRun ? <Button
              variant="primary"
              disabled={busyAction !== null}
              onClick={() => void onAction(
                `automation:${automation.id}:run`,
                () => automationApi.runNow(automation.id),
                labels.feedback.rerunQueued,
              )}
            >
              {runBusy ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
              {labels.dashboard.runNow}
            </Button> : null}
            {canEdit || canDelete ? <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button variant="ghost" className="size-9 p-0" aria-label={labels.details.moreActions}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" className="z-70 min-w-40 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover">
                  {canEdit ? <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover" onSelect={() => onEdit(automation)}>
                    <Pencil className="size-4" />{labels.edit}
                  </DropdownMenu.Item> : null}
                  {canDelete ? <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-red-700 outline-none hover:bg-red-500/10 dark:text-red-300"
                    disabled={busyAction !== null}
                    onSelect={() => { if (window.confirm(labels.experience.deleteConfirm)) void onAction(`automation:${automation.id}:delete`, () => automationApi.remove(automation.id), labels.dashboard.deleted); }}
                  >
                    {deleteBusy ? <RefreshCw className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{labels.dashboard.delete}
                  </DropdownMenu.Item> : null}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root> : null}
          </div>
        ) : null}
      </header>

      <div className="grid gap-5 p-5">
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">{labels.dashboard.latestResult}</h3>
            {runs[0] ? <Button variant="secondary" onClick={() => onSelectRun(runs[0].id)}>{labels.experience.viewResult}</Button> : null}
          </div>
          {runsError ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{runsError}</p> : runsLoading ? <Skeleton className="h-28 w-full" /> : runs[0] ? <div className="space-y-3 rounded-lg border border-edge-subtle bg-surface-base p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted"><span className={cn('rounded-full px-2 py-0.5', statusClass(runs[0].status))}>{labels.status[runs[0].status]}</span>{formatDate(runs[0].createdAtMs, labels, language)}</div>
            <MarkdownView content={runs[0].error || runs[0].summary || (isActiveRun(runs[0]) ? labels.runDetail.resultPending : labels.runDetail.noResult)} compact />
          </div> : <p className="text-sm text-fg-muted">{labels.experience.noRuns}</p>}
          <p className="mt-3 text-xs text-fg-muted">{automation.enabled ? `${labels.next}: ${automationNextRunLabel(automation, labels, language)}` : labels.paused}</p>
        </section>
        <div className="grid gap-5">
          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-fg">{labels.dashboard.runHistory}</h3>
                <p className="mt-1 text-sm text-fg-muted">{labels.dashboard.runHistoryDescription}</p>
              </div>
              <span className="rounded-full bg-surface-base px-2.5 py-1 text-xs text-fg-muted">{runs.length}</span>
            </div>
            {runsLoading ? <Skeleton className="h-24 w-full" /> : runs.length === 0 ? (
              <EmptyState className="min-h-24 py-6" icon={<Activity className="size-5" />} title={labels.empty.runs} />
            ) : (
              <div className="divide-y divide-edge-subtle overflow-hidden rounded-xl border border-edge-subtle bg-surface-base">
                {runs.slice(0, 8).map((run) => (
                  <button key={run.id} type="button" className="block w-full p-3 text-left hover:bg-surface-hover" onClick={() => onSelectRun(run.id)}>
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {run.status === 'succeeded' ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" /> : <Activity className="size-4 shrink-0 text-fg-muted" />}
                        <span className="truncate text-sm font-medium text-fg">{formatDate(run.createdAtMs, labels, language)}</span>
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', statusClass(run.status))}>{labels.status[run.status]}</span>
                    </div>
                    <p className={cn('mt-1 line-clamp-2 pl-6 text-sm text-fg-muted', run.error && 'text-red-700 dark:text-red-300')}>
                      {run.error || run.summary || actionLabel(run.actionSnapshot, labels)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>
          <details className="rounded-lg border border-edge-subtle p-4">
            <summary className="cursor-pointer text-sm font-medium text-fg">{labels.experience.settings}</summary>
            <div className="mt-4 space-y-4">
              <MarkdownView content={automationTaskSummary(automation, labels)} compact />
              <AutomationOverview automation={automation} labels={labels} cronLabels={cronLabels} language={language} projects={projects} />
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

function safetyDescription(mode: AutomationSafetyMode, labels: AutomationsMessages): string {
  if (mode === 'suggest_only') return labels.safety.suggestOnlyDescription;
  if (mode === 'ask_before_apply') return labels.safety.askBeforeApplyDescription;
  return labels.safety.autoApplyDescription;
}

function AutomationOverview({
  automation,
  labels,
  cronLabels,
  language,
  projects,
}: {
  automation: Automation;
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  projects: Project[];
}) {
  const mode = safetyMode(automation);
  const nextRun = automationNextRunLabel(automation, labels, language);
  const nextRunExact = automation.state.nextRunAtMs
    ? formatAutomationDateTime(automation.state.nextRunAtMs, language)
    : undefined;
  const technicalRows: Array<{ label: string; value: string }> = [];

  if (automation.trigger.kind === 'schedule') {
    const schedule = automation.trigger.schedule;
    technicalRows.push({
      label: labels.info.scheduleType,
      value: schedule.kind === 'interval'
        ? labels.info.fixedInterval
        : schedule.kind === 'cron'
          ? labels.info.calendarSchedule
          : labels.info.oneTimeSchedule,
    });
    if (schedule.kind === 'interval') {
      technicalRows.push({ label: labels.info.rawInterval, value: `${schedule.everyMs} ms` });
      if (schedule.anchorMs) {
        technicalRows.push({ label: labels.info.anchor, value: formatAutomationDateTime(schedule.anchorMs, language) });
      }
    } else if (schedule.kind === 'cron') {
      technicalRows.push({ label: labels.info.expression, value: schedule.expr });
      if (schedule.tz) technicalRows.push({ label: labels.info.timezone, value: schedule.tz });
    } else {
      technicalRows.push({ label: labels.info.oneTimeSchedule, value: schedule.at });
    }
  } else if (automation.trigger.kind === 'event') {
    technicalRows.push({ label: labels.info.eventType, value: automation.trigger.eventType });
    if (automation.trigger.source) {
      technicalRows.push({ label: labels.info.eventSource, value: automation.trigger.source });
    }
  } else if (automation.trigger.kind === 'webhook' && automation.trigger.secretId) {
    technicalRows.push({ label: labels.info.webhookSecret, value: automation.trigger.secretId });
  }

  return (
    <aside className="h-fit overflow-hidden rounded-xl border border-edge-subtle bg-surface-base shadow-surface">
      <div className="border-b border-edge-subtle px-4 py-3">
        <h3 className="text-sm font-semibold text-fg">{labels.info.overview}</h3>
      </div>
      <div className="grid gap-4 p-4">
        <OverviewItem
          icon={<CalendarClock className="size-4" aria-hidden />}
          label={labels.info.schedule}
          value={automationTriggerLabel(automation.trigger, labels, cronLabels, language)}
          description={automation.enabled ? `${labels.info.nextRun}：${nextRun}` : nextRun}
          descriptionTitle={nextRunExact}
        />
        <OverviewItem
          icon={automation.action.kind === 'workflow'
            ? <GitBranch className="size-4" aria-hidden />
            : automation.action.kind === 'browser_automation'
              ? <ListTree className="size-4" aria-hidden />
              : automation.action.kind === 'task_command'
                ? <CheckCircle2 className="size-4" aria-hidden />
              : <Zap className="size-4" aria-hidden />}
          label={labels.info.action}
          value={actionLabel(automation.action, labels)}
        />
        <OverviewItem
          icon={<ShieldCheck className="size-4" aria-hidden />}
          label={labels.info.permission}
          value={labels.safety[mode]}
          description={safetyDescription(mode, labels)}
        />
        <OverviewItem
          icon={<GitBranch className="size-4" aria-hidden />}
          label={labels.info.project}
          value={projects.find((project) => project.id === automation.projectId)?.name ?? labels.info.noProject}
        />
        <OverviewItem
          icon={<MessageCircle className="size-4" aria-hidden />}
          label={labels.info.conversation}
          value={automation.conversationMode === 'continuous' ? labels.info.continuousConversation : labels.info.newConversation}
        />
        <OverviewItem
          icon={<CircleAlert className="size-4" aria-hidden />}
          label={labels.info.notifications}
          value={automation.notificationPolicy === 'all'
            ? labels.info.notifyAll
            : automation.notificationPolicy === 'none'
              ? labels.info.notifyNone
              : labels.info.notifyAttention}
        />
        <OverviewItem
          icon={<Activity className="size-4" aria-hidden />}
          label={labels.info.lastRun}
          value={automationLastRunLabel(automation, labels, language)}
          valueTone={automation.state.lastRunStatus === 'failed' || automation.state.lastRunStatus === 'timeout'
            ? 'danger'
            : 'default'}
        />

        {automation.state.consecutiveFailures ? (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {labels.dashboard.failures}：{automation.state.consecutiveFailures}
            {automation.state.lastError ? <p className="mt-1 break-words text-xs">{automation.state.lastError}</p> : null}
          </div>
        ) : automation.state.lastError ? (
          <p className="break-words text-sm text-red-700 dark:text-red-300">{automation.state.lastError}</p>
        ) : null}

        {technicalRows.length > 0 ? (
          <details className="group border-t border-edge-subtle pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent">
              <span>{labels.info.technicalDetails}</span>
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="mt-3 grid gap-2">
              {technicalRows.map((row) => (
                <div key={`${row.label}:${row.value}`} className="grid gap-0.5">
                  <span className="text-xs text-fg-subtle">{row.label}</span>
                  <span className="break-all font-mono text-xs text-fg-muted">{row.value}</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </aside>
  );
}

function OverviewItem({
  icon,
  label,
  value,
  description,
  descriptionTitle,
  valueTone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description?: string;
  descriptionTitle?: string;
  valueTone?: 'default' | 'danger';
}) {
  return (
    <div className="grid grid-cols-[1.25rem_1fr] gap-2.5">
      <span className="mt-0.5 text-fg-subtle">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-fg-muted">{label}</div>
        <div className={cn(
          'mt-1 text-sm font-medium leading-5',
          valueTone === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-fg',
        )}>
          {value}
        </div>
        {description ? (
          <div className="mt-1 text-xs leading-5 text-fg-subtle" title={descriptionTitle}>{description}</div>
        ) : null}
      </div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <span>{label}</span>
      <span className="min-w-0 truncate text-fg">{value}</span>
    </div>
  );
}

function eventTone(type: AutomationRunEvent['type']): string {
  if (type.endsWith('.failed')) return 'bg-red-500';
  if (type.endsWith('.completed')) return 'bg-emerald-500';
  if (type.endsWith('.started')) return 'bg-blue-500';
  return 'bg-fg-muted';
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase text-fg-muted">{label}</div>
      <div className="mt-1 truncate text-sm text-fg">{value}</div>
    </div>
  );
}

function EmptyState({
  className,
  icon,
  title,
}: {
  className?: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className={cn(
      'flex min-h-48 flex-col items-center justify-center text-fg-muted',
      className,
    )}>
      {icon}
      <div className="mt-2 text-sm">{title}</div>
    </div>
  );
}

function AutomationForm({
  form,
  labels,
  setForm,
  projects,
  workflowDefinitions,
  selectedWorkflow,
  workflowsLoading,
  browserAutomations,
  selectedBrowserAutomation,
  browserAutomationsLoading,
  agentOptions,
  agentsLoading,
  defaultAgentId,
  taskOptions,
  tasksLoading,
  language,
  projectLocked = false,
}: {
  form: FormState;
  labels: AutomationsMessages;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  projects: Project[];
  workflowDefinitions: WorkflowDefinition[];
  selectedWorkflow: WorkflowDefinition | null;
  workflowsLoading: boolean;
  browserAutomations: BrowserAutomation[];
  selectedBrowserAutomation: BrowserAutomation | null;
  browserAutomationsLoading: boolean;
  agentOptions: ChatAgentOption[];
  agentsLoading: boolean;
  defaultAgentId: string;
  taskOptions: AutomationTaskOption[];
  tasksLoading: boolean;
  language: StoredLanguage;
  projectLocked?: boolean;
}) {
  const agentsMessages = messages(language).agentsSettings;
  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));
  const intervalMs = automationIntervalMs(form.intervalValue, form.intervalUnit);
  const intervalPreviewNow = Date.now();
  const intervalPreviewTimes = [1, 2, 3].map((step) => (
    formatAutomationRelativeDateTime(intervalPreviewNow + intervalMs * step, language, intervalPreviewNow)
  ));
  const availableTaskOptions = useMemo(
    () => taskOptions.filter((task) => task.id === form.taskId || (
      task.phase !== 'closed' && (!form.projectId || task.projectId === form.projectId)
    )),
    [form.projectId, form.taskId, taskOptions],
  );

  useEffect(() => {
    if (form.actionMode !== 'task_command' || form.agentId.trim() || !defaultAgentId) return;
    setForm((prev) => ({ ...prev, agentId: defaultAgentId }));
  }, [defaultAgentId, form.actionMode, form.agentId, setForm]);

  useEffect(() => {
    if (form.actionMode !== 'workflow') return;
    if (form.workflowId.trim()) return;
    const firstWorkflowId = workflowDefinitions[0]?.id;
    if (!firstWorkflowId) return;
    setForm((prev) => ({
      ...prev,
      workflowId: firstWorkflowId,
      workflowGoal: '',
      workflowInput: { goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' },
      workflowInputValid: true,
    }));
  }, [form.actionMode, form.workflowId, setForm, workflowDefinitions]);

  useEffect(() => {
    if (form.actionMode !== 'browser_automation') return;
    if (form.browserAutomationId.trim()) return;
    const first = browserAutomations[0];
    if (!first) return;
    setForm((prev) => ({
      ...prev,
      browserAutomationId: first.id,
      browserAutomationInputs: defaultBrowserAutomationInputs(first),
    }));
  }, [browserAutomations, form.actionMode, form.browserAutomationId, setForm]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div className="grid gap-4">
        <Field label={labels.form.name}>
          <input className={inputClass} value={form.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label={labels.form.description}>
          <input className={inputClass} value={form.description} onChange={(e) => update({ description: e.target.value })} />
        </Field>
        {!projectLocked ? (
          <Field label={labels.form.project}>
            <Select className={inputClass} value={form.projectId} onChange={(event) => update({ projectId: event.target.value })}>
              <SelectOption value="">{labels.form.noProject}</SelectOption>
              {projects.map((project) => <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>)}
            </Select>
          </Field>
        ) : null}
        <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-3" aria-label={labels.form.rulePreview}>
          <div className="text-xs font-medium text-accent-fg">{labels.form.rulePreview}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg">
            <span>{triggerModeLabel(form.triggerMode, labels)}</span>
            <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            <span>{actionModeLabel(form.actionMode, labels)}</span>
            <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
            <span>{form.projectId ? projects.find((project) => project.id === form.projectId)?.name ?? labels.form.project : labels.form.noProject}</span>
          </div>
        </div>
        <Section step="1" title={labels.form.trigger} description={labels.form.triggerStepDescription} />
        <Select className={inputClass} value={form.triggerMode} onChange={(e) => update({ triggerMode: e.target.value as TriggerMode })}>
          <SelectOption value="manual">{labels.trigger.manual}</SelectOption>
          <SelectOption value="once">{labels.trigger.once}</SelectOption>
          <SelectOption value="daily">{labels.trigger.daily}</SelectOption>
          <SelectOption value="weekly">{labels.trigger.weekly}</SelectOption>
          <SelectOption value="interval">{labels.trigger.interval}</SelectOption>
          <SelectOption value="cron">{labels.trigger.customCron}</SelectOption>
          <SelectOption value="webhook">{labels.trigger.webhook}</SelectOption>
          <SelectOption value="taskBlocked">{labels.trigger.taskBlocked}</SelectOption>
          <SelectOption value="noteCreated">{labels.trigger.noteCreated}</SelectOption>
          <SelectOption value="workflowFailed">{labels.trigger.workflowFailed}</SelectOption>
          <SelectOption value="sessionUpdated">{labels.trigger.sessionUpdated}</SelectOption>
          <SelectOption value="event">{labels.trigger.customEvent}</SelectOption>
        </Select>
        {form.triggerMode === 'once' ? (
          <Field label={labels.form.onceAt}>
            <input
              className={inputClass}
              type="datetime-local"
              value={form.onceAt}
              onChange={(event) => update({ onceAt: event.target.value })}
            />
          </Field>
        ) : null}
        {form.triggerMode === 'daily' || form.triggerMode === 'weekly' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={labels.form.time}><TimePicker value={form.time} onChange={(time) => update({ time })} ariaLabel={labels.form.time} /></Field>
            {form.triggerMode === 'weekly' ? (
              <Field label={labels.form.day}>
                <Select className={inputClass} value={form.weekday} onChange={(e) => update({ weekday: e.target.value })}>
                  <SelectOption value="1">{labels.weekdays.monday}</SelectOption>
                  <SelectOption value="2">{labels.weekdays.tuesday}</SelectOption>
                  <SelectOption value="3">{labels.weekdays.wednesday}</SelectOption>
                  <SelectOption value="4">{labels.weekdays.thursday}</SelectOption>
                  <SelectOption value="5">{labels.weekdays.friday}</SelectOption>
                  <SelectOption value="6">{labels.weekdays.saturday}</SelectOption>
                  <SelectOption value="0">{labels.weekdays.sunday}</SelectOption>
                </Select>
              </Field>
            ) : null}
          </div>
        ) : null}
        {form.triggerMode === 'interval' ? (
          <div className="grid gap-3 rounded-lg border border-edge-subtle bg-surface-base p-3">
            <Field label={labels.form.intervalEvery}>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <input
                  className={inputClass}
                  type="number"
                  min={60_000 / automationIntervalMs(1, form.intervalUnit)}
                  step="any"
                  inputMode="decimal"
                  value={form.intervalValue}
                  onChange={(event) => update({ intervalValue: event.target.value })}
                />
                <Select
                  className={inputClass}
                  value={form.intervalUnit}
                  onChange={(event) => {
                    const intervalUnit = event.target.value as AutomationIntervalUnit;
                    update({
                      intervalValue: convertAutomationIntervalValue(form.intervalValue, form.intervalUnit, intervalUnit),
                      intervalUnit,
                    });
                  }}
                >
                  <SelectOption value="minute">{labels.form.intervalUnits.minute}</SelectOption>
                  <SelectOption value="hour">{labels.form.intervalUnits.hour}</SelectOption>
                  <SelectOption value="day">{labels.form.intervalUnits.day}</SelectOption>
                  <SelectOption value="week">{labels.form.intervalUnits.week}</SelectOption>
                </Select>
              </div>
            </Field>
            <div>
              <div className="text-xs font-medium text-fg-muted">{labels.form.commonIntervals}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {INTERVAL_PRESETS.map((preset) => {
                  const presetMs = automationIntervalMs(preset.value, preset.unit);
                  const selected = presetMs === intervalMs;
                  return (
                    <button
                      key={`${preset.value}:${preset.unit}`}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        selected
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-edge-subtle text-fg-muted hover:border-edge hover:bg-surface-hover hover:text-fg',
                      )}
                      onClick={() => update({ intervalValue: preset.value, intervalUnit: preset.unit })}
                    >
                      {formatAutomationDuration(presetMs, language)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg bg-surface-panel px-3 py-2.5">
              <div className="text-sm font-medium text-fg">{formatAutomationInterval(intervalMs, language)}</div>
              <div className="mt-1 text-xs leading-5 text-fg-muted">
                {labels.form.nextThreeRuns}：{intervalPreviewTimes.join(language === 'zh' ? '、' : ', ')}
              </div>
              <div className="mt-1 text-xs leading-5 text-fg-subtle">{labels.form.fixedIntervalHint}</div>
            </div>
          </div>
        ) : null}
        {form.triggerMode === 'cron' ? (
          <Field label={labels.form.expression}>
            <input className={inputClass} value={form.cronExpr} onChange={(e) => update({ cronExpr: e.target.value })} />
          </Field>
        ) : null}
        {form.triggerMode === 'webhook' ? (
          <Field label={labels.form.secretId}>
            <input className={inputClass} value={form.webhookSecretId} onChange={(e) => update({ webhookSecretId: e.target.value })} />
          </Field>
        ) : null}
        {form.triggerMode === 'event' ? (
          <div className="grid gap-3 rounded-lg border border-edge-subtle bg-surface-base p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={labels.form.eventType}>
                <input className={inputClass} value={form.eventType} onChange={(event) => update({ eventType: event.target.value })} />
              </Field>
              <Field label={labels.form.eventSource}>
                <input className={inputClass} value={form.eventSource} onChange={(event) => update({ eventSource: event.target.value })} />
              </Field>
            </div>
            <Field label={labels.form.eventPayloadMatch}>
              <textarea
                className={cn(inputClass, 'min-h-24 resize-y font-mono text-xs')}
                value={form.eventPayloadMatch}
                onChange={(event) => update({ eventPayloadMatch: event.target.value })}
                placeholder={'{\n  "status": "blocked"\n}'}
              />
              {!payloadMatchIsValid(form.eventPayloadMatch) ? (
                <span className="text-xs text-red-700 dark:text-red-300">{labels.form.invalidJsonObject}</span>
              ) : null}
            </Field>
          </div>
        ) : null}

        <Section step="2" title={labels.form.action} description={labels.form.actionStepDescription} />
        <Select
          className={inputClass}
          value={form.actionMode}
          onChange={(e) => {
            const actionMode = e.target.value as ActionMode;
            const currentTimeout = Number.parseInt(form.timeoutSeconds, 10);
            const usesActionDefault = currentTimeout === 600 || currentTimeout === 1800;
            update({
              actionMode,
              ...(usesActionDefault
                ? { timeoutSeconds: actionMode === 'browser_automation' ? '600' : '1800' }
                : {}),
              ...(actionMode === 'browser_automation' || actionMode === 'task_command'
                ? { safetyMode: 'auto_apply' as const }
                : {}),
              ...(actionMode === 'workflow' && !form.workflowId.trim() && workflowDefinitions[0]
                ? {
                    workflowId: workflowDefinitions[0].id,
                    workflowGoal: '',
                    workflowInput: { goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' },
                    workflowInputValid: true,
                  }
                : {}),
            });
          }}
        >
          <SelectOption value="agent">{labels.action.runAgent}</SelectOption>
          <SelectOption value="workflow">{labels.action.runWorkflow}</SelectOption>
          <SelectOption value="task_command">{labels.action.runTask}</SelectOption>
          <SelectOption value="browser_automation">{language === 'zh' ? '浏览器自动化' : 'Browser automation'}</SelectOption>
        </Select>
        {form.actionMode !== 'browser_automation' ? <Field label={labels.form.agent}>
          <Select
            className={inputClass}
            value={form.agentId}
            onChange={(e) => update({ agentId: e.target.value })}
          >
            <SelectOption value="">{agentsLoading ? labels.form.loadingAgents : labels.form.defaultAgent}</SelectOption>
            {agentOptions.map((agent) => (
              <SelectOption key={agent.id} value={agent.id}>
                {agentListDisplayName(agent, agentsMessages)}
              </SelectOption>
            ))}
          </Select>
        </Field> : null}
        {form.actionMode === 'agent' ? (
          <>
            <Field label={labels.form.model}>
              <ModelSelector
                value={form.model}
                onChange={(model) => update({ model })}
                placeholder={labels.form.defaultModel}
                emptyLabel={labels.form.defaultModel}
                searchPlaceholder={labels.form.searchModels}
                noMatches={labels.form.noModels}
                allowEmpty
                showProviderSettingsFooter
                contentAlign="start"
                className="w-full"
                ariaLabel={labels.form.model}
              />
              <span className="text-xs text-fg-subtle">{labels.form.modelHint}</span>
            </Field>
            <Field label={labels.form.instruction}>
              <div className="flex justify-end">
                <AiTextAssistButton
                  value={form.instruction}
                  onApply={(instruction) => update({ instruction })}
                  fieldId="automation.instruction"
                  fieldLabel={labels.form.instruction}
                  scenario="automation.instruction"
                  locale={language}
                  context={{
                    automationName: form.name,
                    automationDescription: form.description,
                    triggerMode: form.triggerMode,
                    agentId: form.agentId,
                    model: form.model,
                  }}
                  showLabel={false}
                />
              </div>
              <textarea className={cn(inputClass, 'min-h-32 resize-y')} value={form.instruction} onChange={(e) => update({ instruction: e.target.value })} />
            </Field>
          </>
        ) : form.actionMode === 'workflow' ? (
          <>
            <Field label={labels.form.workflow}>
              <Select
                className={inputClass}
                value={form.workflowId}
                onChange={(e) => update({
                  workflowId: e.target.value,
                  workflowGoal: '',
                  workflowInput: { goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' },
                  workflowInputValid: true,
                })}
                disabled={workflowsLoading || workflowDefinitions.length === 0}
              >
                {workflowsLoading ? <SelectOption value="">{labels.form.loadingWorkflows}</SelectOption> : null}
                {!workflowsLoading && workflowDefinitions.length === 0 ? <SelectOption value="">{labels.form.noWorkflows}</SelectOption> : null}
                {workflowDefinitions.map((workflow) => (
                  <SelectOption key={workflow.id} value={workflow.id}>
                    {workflow.title || workflow.name}
                  </SelectOption>
                ))}
              </Select>
            </Field>
            {selectedWorkflow ? (
              <WorkflowRunSetupPanel
                definition={selectedWorkflow}
                language={language}
                value={form.workflowInput}
                onChange={(workflowInput) => update({
                  workflowInput,
                  workflowGoal: workflowInput.goal,
                  workflowInputValid: true,
                })}
                mode="automation"
                badgeLabel={labels.form.triggeredRun}
                onValidityChange={(validity) => update({ workflowInputValid: validity.valid })}
                aiAssist={{
                  inputScenario: 'automation.workflowInput',
                  goalScenario: 'automation.workflowGoal',
                  context: {
                    automationName: form.name,
                    automationDescription: form.description,
                    triggerMode: form.triggerMode,
                    workflowId: selectedWorkflow.id,
                    workflowTitle: selectedWorkflow.title,
                    workflowDescription: selectedWorkflow.description,
                  },
                }}
                inputClassName="rounded-lg"
              />
            ) : null}
          </>
        ) : form.actionMode === 'task_command' ? (
          <>
            <Field label={labels.form.task}>
              <Select
                className={inputClass}
                value={form.taskId}
                onChange={(event) => update({ taskId: event.target.value })}
                disabled={tasksLoading || availableTaskOptions.length === 0}
              >
                {tasksLoading ? <SelectOption value="">{labels.form.loadingTasks}</SelectOption> : null}
                {!tasksLoading && availableTaskOptions.length === 0
                  ? <SelectOption value="">{labels.form.noTasks}</SelectOption>
                  : null}
                {availableTaskOptions.map((task) => (
                  <SelectOption key={task.id} value={task.id} disabled={task.phase === 'closed'}>
                    {task.title}{task.phase === 'closed' ? ` · ${labels.form.taskClosed}` : ''}
                  </SelectOption>
                ))}
              </Select>
              <p className="mt-1 text-xs leading-5 text-fg-muted">{labels.form.taskContextHint}</p>
            </Field>
          </>
        ) : (
          <>
            <Field label={language === 'zh' ? '浏览器自动化' : 'Browser automation'}>
              <Select
                className={inputClass}
                value={form.browserAutomationId}
                onChange={(event) => {
                  const workflow = browserAutomations.find((item) => item.id === event.target.value);
                  update({
                    browserAutomationId: event.target.value,
                    browserAutomationInputs: workflow ? defaultBrowserAutomationInputs(workflow) : {},
                  });
                }}
                disabled={browserAutomationsLoading || browserAutomations.length === 0}
              >
                {browserAutomations.length === 0 ? <SelectOption value="">{language === 'zh' ? '没有已启用的浏览器自动化' : 'No enabled browser automations'}</SelectOption> : null}
                {browserAutomations.map((workflow) => <SelectOption key={workflow.id} value={workflow.id}>{workflow.name}</SelectOption>)}
              </Select>
            </Field>
            {selectedBrowserAutomation && Object.keys(selectedBrowserAutomation.inputs).length > 0 ? <Field label={language === 'zh' ? '运行时填写' : 'Run inputs'}><BrowserAutomationInputFields automation={selectedBrowserAutomation} values={form.browserAutomationInputs} language={language} onChange={(browserAutomationInputs) => update({ browserAutomationInputs })} /></Field> : null}
          </>
        )}

        <details className="group rounded-xl border border-edge-subtle bg-surface-base">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs text-fg-muted">3</span>
              <span>
                {labels.form.advanced}
                <span className="ml-2 text-xs font-normal text-fg-muted">{labels.form.advancedDescription}</span>
              </span>
            </span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-4 border-t border-edge-subtle p-4">
        {form.actionMode !== 'browser_automation' && form.actionMode !== 'task_command' ? <><Section title={labels.form.safety} />
        <Field label={labels.form.safety}>
          <Select
            className={inputClass}
            value={form.safetyMode}
            onChange={(e) => {
              const safetyMode = e.target.value as AutomationSafetyMode;
              update({ safetyMode });
            }}
          >
            <SelectOption value="suggest_only">{labels.safety.suggest_only}</SelectOption>
            <SelectOption value="ask_before_apply">{labels.safety.ask_before_apply}</SelectOption>
            <SelectOption value="auto_apply">{labels.safety.auto_apply}</SelectOption>
          </Select>
          <p className="mt-1 text-xs leading-5 text-fg-muted">
            {form.safetyMode === 'suggest_only'
              ? labels.safety.suggestOnlyDescription
              : form.safetyMode === 'ask_before_apply'
                ? labels.safety.askBeforeApplyDescription
                : labels.safety.autoApplyDescription}
          </p>
        </Field></> : null}

        <Section title={labels.form.results} />
        <Field label={labels.form.conversation}>
          <Select className={inputClass} value={form.conversationMode} onChange={(e) => update({ conversationMode: e.target.value as FormState['conversationMode'] })}>
            <SelectOption value="new_session">{labels.form.newConversation}</SelectOption>
            <SelectOption value="continuous">{labels.form.continuousConversation}</SelectOption>
          </Select>
        </Field>
        <Field label={labels.form.notifications}>
          <Select className={inputClass} value={form.notificationPolicy} onChange={(e) => update({ notificationPolicy: e.target.value as FormState['notificationPolicy'] })}>
            <SelectOption value="attention">{labels.form.notifyAttention}</SelectOption>
            <SelectOption value="all">{labels.form.notifyAll}</SelectOption>
            <SelectOption value="none">{labels.form.notifyNone}</SelectOption>
          </Select>
        </Field>
        {form.safetyMode === 'auto_apply' ? (
          <Field label={labels.form.completionWebhook}>
            <input className={inputClass} value={form.completionWebhookUrl} onChange={(e) => update({ completionWebhookUrl: e.target.value })} />
          </Field>
        ) : null}

        <Section title={labels.form.reliability} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={labels.form.timeoutSeconds}>
            <input className={inputClass} inputMode="numeric" value={form.timeoutSeconds} onChange={(e) => update({ timeoutSeconds: e.target.value })} />
          </Field>
          <Field label={labels.form.disableAfterFailures}>
            <input className={inputClass} inputMode="numeric" value={form.disableAfterFailures} onChange={(e) => update({ disableAfterFailures: e.target.value })} />
          </Field>
        </div>
        <div className="rounded-lg border border-edge bg-surface-inset/40 px-3 py-2.5">
          <p className="text-xs font-medium text-fg">{labels.form.effectivePolicy}</p>
          <p className="mt-1 text-xs text-fg-muted">
            {labels.form.executionDeadline}: {form.timeoutSeconds || '—'}s
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-subtle">
            {labels.form.downstreamTimeoutHint}
          </p>
        </div>
          </div>
        </details>
      </div>
    </div>
  );
}

const inputClass = 'min-h-11 w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-base sm:min-h-0 sm:text-sm text-fg outline-none focus:border-accent';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Section({ title, step, description }: { title: string; step?: string; description?: string }) {
  return (
    <div className="flex items-start gap-2 pt-2">
      {step ? (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent-fg">{step}</span>
      ) : <GitBranch className="mt-0.5 size-4 text-fg-muted" />}
      <div>
        <div className="text-sm font-semibold text-fg">{title}</div>
        {description ? <p className="mt-0.5 text-xs leading-5 text-fg-muted">{description}</p> : null}
      </div>
    </div>
  );
}
