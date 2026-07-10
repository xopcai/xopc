import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/ui/refresh-button';
import { AiTextAssistButton } from '@/features/ai-assist/ai-text-assist-button';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { formatCronExpressionLabel } from '@/features/scheduling/cron/format-cron-label';
import { messages, type MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';
import { showToast } from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { listWorkflowDefinitions, type WorkflowDefinition } from '@/features/workflows/workflow-api';
import {
  resolveWorkflowInputPayload,
  validateWorkflowInputEditorValue,
} from '@/features/workflows/workflow-input-editor';
import { WorkflowRunSetupPanel, type WorkflowRunSetupValue } from '@/features/workflows/workflow-run-setup-panel';
import {
  automationApi,
  type Automation,
  type AutomationAction,
  type AutomationDraft,
  type AutomationInput,
  type AutomationRepairDraft,
  type AutomationRun,
  type AutomationRunEvent,
  type AutomationSafetyMode,
  type AutomationTrigger,
} from './automation-api';
import { Select, SelectOption } from '@/components/ui/popover-select';

type CreateMode = 'blank' | 'draft' | 'template';
type ViewTab = 'activity' | 'automations';
type TriggerMode =
  | 'manual'
  | 'daily'
  | 'weekly'
  | 'interval'
  | 'cron'
  | 'webhook'
  | 'goalBlocked'
  | 'noteCreated'
  | 'workflowFailed'
  | 'sessionUpdated';
type ActionMode = 'agent' | 'workflow';
type AutomationsMessages = MessageBundle['automations'];
type CronMessages = MessageBundle['cron'];
type RunEventLabels = AutomationsMessages['events'];

interface FormState {
  name: string;
  description: string;
  triggerMode: TriggerMode;
  time: string;
  weekday: string;
  intervalMinutes: string;
  cronExpr: string;
  webhookSecretId: string;
  actionMode: ActionMode;
  agentId: string;
  instruction: string;
  workflowId: string;
  workflowGoal: string;
  workflowInput: WorkflowRunSetupValue;
  workflowInputValid: boolean;
  safetyMode: AutomationSafetyMode;
  timeoutSeconds: string;
  afterRunMode: 'none' | 'saveToSession' | 'webhook';
  webhookUrl: string;
  disableAfterFailures: string;
}

const initialForm: FormState = {
  name: '',
  description: '',
  triggerMode: 'daily',
  time: '09:00',
  weekday: '1',
  intervalMinutes: '60',
  cronExpr: '0 9 * * *',
  webhookSecretId: '',
  actionMode: 'agent',
  agentId: '',
  instruction: '',
  workflowId: '',
  workflowGoal: '',
  workflowInput: { goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' },
  workflowInputValid: true,
  safetyMode: 'suggest_only',
  timeoutSeconds: '300',
  afterRunMode: 'none',
  webhookUrl: '',
  disableAfterFailures: '3',
};

function automationLocale(language: StoredLanguage): string {
  return language === 'zh' ? 'zh-CN' : 'en-US';
}

function formatDate(ms: number | undefined, labels: AutomationsMessages, language: StoredLanguage): string {
  if (!ms) return labels.never;
  return new Intl.DateTimeFormat(automationLocale(language), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function triggerLabel(trigger: AutomationTrigger, labels: AutomationsMessages, cronLabels: CronMessages, language: StoredLanguage): string {
  if (trigger.kind === 'manual') return labels.trigger.manual;
  if (trigger.kind === 'webhook') return labels.trigger.webhook;
  if (trigger.kind === 'event') return labels.trigger.eventWithType.replace('{type}', trigger.eventType);
  const schedule = trigger.schedule;
  if (schedule.kind === 'once') return labels.trigger.onceAt.replace('{time}', formatDate(Date.parse(schedule.at), labels, language));
  if (schedule.kind === 'interval') return labels.trigger.everyMinutes.replace('{minutes}', String(Math.round(schedule.everyMs / 60000)));
  return formatCronExpressionLabel(schedule.expr, automationLocale(language), cronLabels.scheduleBadge, {
    timezone: schedule.tz,
  });
}

function actionLabel(action: AutomationAction, labels: AutomationsMessages): string {
  if (action.kind === 'workflow') return labels.action.workflowWithId.replace('{id}', action.workflowId);
  return action.agentId ? labels.action.agentWithId.replace('{id}', action.agentId) : labels.action.agent;
}

function safetyMode(automation: Automation): AutomationSafetyMode {
  return automation.safety?.mode ?? 'auto_apply';
}

function statusClass(status?: AutomationRun['status']) {
  if (status === 'succeeded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'running' || status === 'queued') return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
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
  return run.status === 'running' || run.status === 'queued';
}

function needsAttention(run: AutomationRun): boolean {
  return run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled';
}

function automationManagedBy(automation: Automation): string | null {
  const marker = automation.description?.match(/\[managed-by=([^\]]+)\]/);
  return marker?.[1]?.trim() || null;
}

function isSystemManagedAutomation(automation: Automation): boolean {
  return Boolean(automationManagedBy(automation));
}

function visibleAutomationDescription(automation: Automation): string {
  return automation.description?.replace(/\s*\[managed-by=[^\]]+\]\s*/g, ' ').trim() ?? '';
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

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function buildInput(form: FormState, selectedWorkflow: WorkflowDefinition | null): AutomationInput {
  const [hourRaw, minuteRaw] = form.time.split(':');
  const hour = Number.parseInt(hourRaw || '9', 10);
  const minute = Number.parseInt(minuteRaw || '0', 10);
  let trigger: AutomationTrigger;
  if (form.triggerMode === 'manual') {
    trigger = { kind: 'manual' };
  } else if (form.triggerMode === 'webhook') {
    trigger = { kind: 'webhook', ...(form.webhookSecretId.trim() ? { secretId: form.webhookSecretId.trim() } : {}) };
  } else if (form.triggerMode === 'goalBlocked') {
    trigger = {
      kind: 'event',
      eventType: 'goal.status_changed',
      source: 'goals',
      payloadMatch: { status: 'blocked' },
    };
  } else if (form.triggerMode === 'noteCreated') {
    trigger = { kind: 'event', eventType: 'note.created', source: 'notes' };
  } else if (form.triggerMode === 'workflowFailed') {
    trigger = {
      kind: 'event',
      eventType: 'workflow.run.completed',
      source: 'workflows',
      payloadMatch: { status: 'failed' },
    };
  } else if (form.triggerMode === 'sessionUpdated') {
    trigger = { kind: 'event', eventType: 'session.transcript.updated', source: 'sessions' };
  } else if (form.triggerMode === 'interval') {
    trigger = {
      kind: 'schedule',
      schedule: {
        kind: 'interval',
        everyMs: Math.max(1, Number.parseInt(form.intervalMinutes, 10) || 60) * 60_000,
      },
    };
  } else if (form.triggerMode === 'weekly') {
    trigger = { kind: 'schedule', schedule: { kind: 'cron', expr: `${minute} ${hour} * * ${form.weekday}` } };
  } else if (form.triggerMode === 'cron') {
    trigger = { kind: 'schedule', schedule: { kind: 'cron', expr: form.cronExpr.trim() } };
  } else {
    trigger = { kind: 'schedule', schedule: { kind: 'cron', expr: `${minute} ${hour} * * *` } };
  }

  const workflowInput = resolveWorkflowInputPayload(selectedWorkflow, form.workflowInput);
  const workflowGoal = form.workflowInput.goal.trim() || form.workflowGoal.trim();
  const afterRunMode = form.safetyMode === 'auto_apply' ? form.afterRunMode : 'none';
  const action: AutomationAction =
    form.actionMode === 'workflow'
      ? {
          kind: 'workflow',
          workflowId: form.workflowId.trim(),
          ...(form.agentId.trim() ? { agentId: form.agentId.trim() } : {}),
          ...(workflowInput !== undefined ? { input: workflowInput } : {}),
          ...(workflowGoal ? { goal: workflowGoal } : {}),
          ...(form.workflowInput.concurrency.trim()
            ? { concurrency: Math.max(1, Number.parseInt(form.workflowInput.concurrency, 10) || 1) }
            : {}),
          ...(form.workflowInput.maxSubagents.trim()
            ? { maxSubagents: Math.max(1, Number.parseInt(form.workflowInput.maxSubagents, 10) || 1) }
            : {}),
          timeoutSeconds: Math.max(1, Number.parseInt(form.timeoutSeconds, 10) || 300),
        }
      : {
          kind: 'agent',
          instruction: form.instruction.trim(),
          ...(form.agentId.trim() ? { agentId: form.agentId.trim() } : {}),
          timeoutSeconds: Math.max(1, Number.parseInt(form.timeoutSeconds, 10) || 300),
        };

  return {
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    trigger,
    action,
    safety: { mode: form.safetyMode },
    afterRun:
      afterRunMode === 'webhook'
        ? { kind: 'webhook', url: form.webhookUrl.trim() }
        : { kind: afterRunMode },
    reliability: {
      timeoutSeconds: Math.max(1, Number.parseInt(form.timeoutSeconds, 10) || 300),
      disableAfterConsecutiveFailures: Math.max(1, Number.parseInt(form.disableAfterFailures, 10) || 3),
    },
  };
}

export function AutomationsPage() {
  const language = useLocaleStore((s) => s.language);
  const messageBundle = messages(language);
  const labels = messageBundle.automations;
  const cronLabels = messageBundle.cron;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const [searchParams, setSearchParams] = useSearchParams();
  const runParam = searchParams.get('run')?.trim() ?? '';
  const draftParam = searchParams.get('draft')?.trim() ?? '';
  const actionParam = searchParams.get('action')?.trim() ?? '';
  const projectIdParam = searchParams.get('projectId')?.trim() ?? '';
  const autogenerateDraft = searchParams.get('autogenerate') === '1';
  const draftSeedRef = useRef('');
  const wideActivityLayout = useMediaQuery('(min-width: 1280px)');
  const [viewTab, setViewTab] = useState<ViewTab>('activity');
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('blank');
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetailOpen, setRunDetailOpen] = useState(false);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftApproved, setDraftApproved] = useState(false);
  const [repairDraft, setRepairDraft] = useState<AutomationRepairDraft | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairApproved, setRepairApproved] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const automationsSwr = useSWR(
    ['automations', projectIdParam],
    () => automationApi.list(projectIdParam ? { projectId: projectIdParam } : undefined),
    { refreshInterval: 15_000 },
  );
  const runsSwr = useSWR(
    ['automation-runs', projectIdParam],
    () => automationApi.runs(50, undefined, projectIdParam ? { projectId: projectIdParam } : undefined),
    { refreshInterval: 10_000 },
  );
  const metricsSwr = useSWR('automation-metrics', () => automationApi.metrics(), { refreshInterval: 15_000 });
  const runEventsSwr = useSWR(
    selectedRunId ? `automation-run-events:${selectedRunId}` : null,
    () => automationApi.runEvents(selectedRunId!),
    { refreshInterval: 5_000 },
  );
  const workflowDefinitionsSwr = useSWR('automation-workflow-definitions', listWorkflowDefinitions);
  const chatAgentsSwr = useSWR('automation-chat-agents', fetchChatAgents);

  const automations = automationsSwr.data?.automations ?? [];
  const runs = useMemo(() => sortRunsForOperations(runsSwr.data?.runs ?? []), [runsSwr.data?.runs]);
  const userAutomations = useMemo(
    () => automations.filter((automation) => !isSystemManagedAutomation(automation)),
    [automations],
  );
  const systemAutomations = useMemo(
    () => automations.filter(isSystemManagedAutomation),
    [automations],
  );
  const systemAutomationIds = useMemo(
    () => new Set(systemAutomations.map((automation) => automation.id)),
    [systemAutomations],
  );
  const userRuns = useMemo(
    () => runs.filter((run) => !systemAutomationIds.has(run.automationId)),
    [runs, systemAutomationIds],
  );
  const nextUserRunAtMs = useMemo(() => {
    let next: number | undefined;
    for (const automation of userAutomations) {
      const runAtMs = automation.state.nextRunAtMs;
      if (!runAtMs) continue;
      if (next == null || runAtMs < next) next = runAtMs;
    }
    return next;
  }, [userAutomations]);
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === selectedAutomationId) ?? null,
    [automations, selectedAutomationId],
  );
  const selectedAutomationRuns = useMemo(
    () => runs.filter((run) => run.automationId === selectedAutomationId),
    [runs, selectedAutomationId],
  );
  const runEvents = runEventsSwr.data?.events ?? [];
  const attentionRuns = useMemo(() => userRuns.filter(needsAttention), [userRuns]);
  const latestRun = userRuns[0] ?? null;
  const workflowDefinitions = useMemo(() => workflowDefinitionsSwr.data ?? [], [workflowDefinitionsSwr.data]);
  const agentOptions = chatAgentsSwr.data?.items ?? [];
  const selectedWorkflow = useMemo(
    () => workflowDefinitions.find((workflow) => workflow.id === form.workflowId.trim()) ?? null,
    [form.workflowId, workflowDefinitions],
  );
  const workflowSelectionInvalid =
    form.actionMode === 'workflow' &&
    (!form.workflowId.trim() ||
      (workflowDefinitions.length > 0 && !workflowDefinitions.some((workflow) => workflow.id === form.workflowId)));
  const workflowInputInvalid =
    form.actionMode === 'workflow' && selectedWorkflow
      ? !validateWorkflowInputEditorValue(selectedWorkflow, form.workflowInput, form.workflowInputValid).valid
      : false;
  const formCanSubmit =
    Boolean(form.name.trim()) &&
    (form.actionMode === 'workflow'
      ? !workflowSelectionInvalid && !workflowInputInvalid
      : Boolean(form.instruction.trim())) &&
    (form.afterRunMode !== 'webhook' || Boolean(form.webhookUrl.trim()));
  const templates = useMemo(
    () => [
      {
        name: labels.templates.dailyAgent.name,
        description: labels.templates.dailyAgent.description,
        form: { ...initialForm, name: labels.templates.dailyAgent.name, instruction: labels.templates.dailyAgent.instruction, triggerMode: 'daily' as const },
      },
      {
        name: labels.templates.morningWorkflow.name,
        description: labels.templates.morningWorkflow.description,
        form: {
          ...initialForm,
          name: labels.templates.morningWorkflow.formName,
          actionMode: 'workflow' as const,
          workflowId: workflowDefinitions[0]?.id ?? '',
        },
      },
      {
        name: labels.templates.webhookAgent.name,
        description: labels.templates.webhookAgent.description,
        form: { ...initialForm, name: labels.templates.webhookAgent.formName, triggerMode: 'webhook' as const },
      },
      {
        name: labels.templates.blockedGoal.name,
        description: labels.templates.blockedGoal.description,
        form: {
          ...initialForm,
          name: labels.templates.blockedGoal.formName,
          triggerMode: 'goalBlocked' as const,
          instruction: labels.templates.blockedGoal.instruction,
        },
      },
      {
        name: labels.templates.noteCreated.name,
        description: labels.templates.noteCreated.description,
        form: {
          ...initialForm,
          name: labels.templates.noteCreated.formName,
          triggerMode: 'noteCreated' as const,
          instruction: labels.templates.noteCreated.instruction,
        },
      },
    ],
    [labels, workflowDefinitions],
  );

  const reload = useCallback(async () => {
    await Promise.all([automationsSwr.mutate(), runsSwr.mutate(), metricsSwr.mutate(), runEventsSwr.mutate()]);
  }, [automationsSwr.mutate, metricsSwr.mutate, runEventsSwr.mutate, runsSwr.mutate]);

  const openCreate = useCallback((mode: CreateMode) => {
    setCreateMode(mode);
    setCreateOpen(true);
    if (mode === 'blank') setForm(initialForm);
  }, []);

  const refreshNow = useCallback(async () => {
    setRefreshBusy(true);
    setError(null);
    try {
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      showToast({ type: 'error', title: labels.feedback.actionFailed, message });
    } finally {
      setRefreshBusy(false);
    }
  }, [labels.feedback.actionFailed, reload]);

  useEffect(() => {
    if (!runParam) return;
    setViewTab('activity');
    setSelectedRunId(runParam);
    if (!wideActivityLayout) setRunDetailOpen(true);
  }, [runParam, wideActivityLayout]);

  useEffect(() => {
    if (wideActivityLayout) setRunDetailOpen(false);
  }, [wideActivityLayout]);

  useEffect(() => {
    if (actionParam !== 'create') return;
    openCreate('blank');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('action');
      return next;
    }, { replace: true });
  }, [actionParam, openCreate, setSearchParams]);

  useEffect(() => {
    if (!draftParam) return;
    const marker = `${language}:${autogenerateDraft ? 'auto' : 'seed'}:${draftParam}`;
    if (draftSeedRef.current === marker) return;
    draftSeedRef.current = marker;
    setDraftPrompt(draftParam);
    setDraft(null);
    setDraftApproved(false);
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
  }, [autogenerateDraft, draftParam, language, setSearchParams]);

  const selectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    if (!wideActivityLayout) setRunDetailOpen(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('run', runId);
      return next;
    }, { replace: true });
  }, [setSearchParams, wideActivityLayout]);

  useEffect(() => {
    setRepairDraft(null);
    setRepairApproved(false);
  }, [selectedRunId]);

  async function submitForm() {
    setError(null);
    if (!formCanSubmit) return;
    try {
      await automationApi.create({
        ...buildInput(form, selectedWorkflow),
        ...(projectIdParam ? { projectId: projectIdParam } : {}),
      });
      setForm(initialForm);
      setCreateOpen(false);
      await reload();
      showToast({ type: 'success', title: labels.dashboard.created });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      showToast({ type: 'error', title: labels.feedback.actionFailed, message });
    }
  }

  async function mutateAutomation(actionKey: string, action: () => Promise<unknown>, successTitle?: string): Promise<boolean> {
    setError(null);
    setBusyAction(actionKey);
    try {
      await action();
      await reload();
      if (successTitle) showToast({ type: 'success', title: successTitle });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      showToast({ type: 'error', title: labels.feedback.actionFailed, message });
      return false;
    } finally {
      setBusyAction(null);
    }
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
    await mutateAutomation('draft:publish', async () => {
      await automationApi.create({
        ...draft.automation,
        ...(projectIdParam ? { projectId: projectIdParam } : {}),
      });
      setDraft(null);
      setDraftPrompt('');
      setDraftApproved(false);
      setCreateOpen(false);
    }, labels.dashboard.created);
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
    }, labels.feedback.repairApplied);
  }

  const headerEnd = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <RefreshButton className="size-9 shrink-0 p-0" loading={refreshBusy} label={labels.refresh} onClick={refreshNow} />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="primary">
              <Plus className="size-4" />
              {labels.new}
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="z-70 min-w-52 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover"
            >
              <DropdownMenu.Item
                className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover"
                onSelect={() => openCreate('draft')}
              >
                {labels.createMenu.draft}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover"
                onSelect={() => openCreate('template')}
              >
                {labels.createMenu.template}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover"
                onSelect={() => openCreate('blank')}
              >
                {labels.createMenu.blank}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    ),
    [labels.createMenu.blank, labels.createMenu.draft, labels.createMenu.template, labels.new, labels.refresh, openCreate, refreshBusy, refreshNow],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{labels.title}</h1>
          <p className="truncate text-xs text-fg-muted">{labels.subtitle}</p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, labels.subtitle, labels.title, setPageHeader]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <div className="flex w-full flex-col gap-5 px-3 py-6 sm:px-5 xl:px-6">
        <section className="grid gap-3 sm:grid-cols-4">
          <Metric
            label={labels.dashboard.needsAttention}
            value={attentionRuns.length}
            tone={attentionRuns.length > 0 ? 'danger' : 'neutral'}
          />
          <Metric label={labels.metrics.running} value={userRuns.filter((r) => r.status === 'running').length} />
          <Metric
            label={labels.dashboard.latestResult}
            value={latestRun ? labels.status[latestRun.status] : labels.none}
            tone={latestRun && needsAttention(latestRun) ? 'danger' : 'neutral'}
          />
          <Metric label={labels.metrics.next} value={nextUserRunAtMs ? formatDate(nextUserRunAtMs, labels, language) : labels.none} />
        </section>

        <nav className="inline-flex w-fit rounded-lg border border-edge bg-surface-panel p-1">
          {([
            { id: 'activity' as const, label: labels.dashboard.activity, count: userRuns.length },
            { id: 'automations' as const, label: labels.dashboard.manage, count: userAutomations.length },
          ]).map((item) => (
            <button
              key={item.id}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-fg-muted',
                viewTab === item.id && 'bg-surface-hover text-fg',
              )}
              onClick={() => {
                setViewTab(item.id);
                if (item.id !== 'activity') setRunDetailOpen(false);
              }}
            >
              <span>{item.label}</span>
              <span className="rounded-full border border-edge/70 px-1.5 py-0.5 text-[0.6875rem] leading-none text-fg-muted">
                {item.count}
              </span>
            </button>
          ))}
        </nav>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {viewTab === 'activity' ? (
          <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="min-w-0">
              <RunsList
                runs={userRuns.slice(0, 12)}
                labels={labels}
                cronLabels={cronLabels}
                language={language}
                selectedRunId={selectedRunId}
                busyAction={busyAction}
                className="h-auto"
                onSelectRun={selectRun}
                onAction={mutateAutomation}
              />
            </div>
            <RunDetailPanel
              className="hidden xl:block"
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
          </section>
        ) : (
          <section>
            <AutomationList
              automations={userAutomations}
              runs={userRuns}
              labels={labels}
              cronLabels={cronLabels}
              language={language}
              busyAction={busyAction}
              onOpenDetails={setSelectedAutomationId}
              onAction={mutateAutomation}
            />
            {systemAutomations.length > 0 ? (
              <SystemAutomationSection
                automations={systemAutomations}
                runs={runs}
                labels={labels}
                cronLabels={cronLabels}
                language={language}
                busyAction={busyAction}
                onOpenDetails={setSelectedAutomationId}
                onAction={mutateAutomation}
              />
            ) : null}
          </section>
        )}
      </div>

      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(760px,calc(100vh-2rem))] w-[min(100%-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
            <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">
                {createMode === 'draft'
                  ? labels.draft.title
                  : createMode === 'template'
                    ? labels.createMenu.templatesTitle
                    : labels.createTitle}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" aria-label={labels.close}>
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
            {createMode === 'draft' ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <DraftPanel
                  labels={labels}
                  prompt={draftPrompt}
                  draft={draft}
                  loading={draftLoading}
                  approved={draftApproved}
                  publishBusy={busyAction === 'draft:publish'}
                  onPromptChange={setDraftPrompt}
                  onGenerate={generateDraft}
                  onPublish={publishDraft}
                  onApprovedChange={setDraftApproved}
                  onDiscard={() => {
                    setDraft(null);
                    setDraftApproved(false);
                  }}
                />
              </div>
            ) : createMode === 'template' ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="grid gap-3 md:grid-cols-2">
                  {templates.map((template) => (
                    <button
                      key={template.name}
                      className="rounded-lg bg-surface-base p-4 text-left hover:bg-surface-hover"
                      onClick={() => {
                        setForm(template.form);
                        setCreateMode('blank');
                      }}
                    >
                      <div className="font-medium text-fg">{template.name}</div>
                      <div className="mt-2 text-sm text-fg-muted">{template.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <AutomationForm
                  form={form}
                  labels={labels}
                  setForm={setForm}
                  workflowDefinitions={workflowDefinitions}
                  selectedWorkflow={selectedWorkflow}
                  workflowsLoading={workflowDefinitionsSwr.isLoading}
                  agentOptions={agentOptions}
                  agentsLoading={chatAgentsSwr.isLoading}
                  language={language}
                />
                <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
                  <Dialog.Close asChild>
                    <Button variant="ghost">{labels.cancel}</Button>
                  </Dialog.Close>
                  <Button variant="primary" onClick={submitForm} disabled={!formCanSubmit}>
                    {labels.create}
                  </Button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <AutomationDetailDialog
        automation={selectedAutomation}
        runs={selectedAutomationRuns}
        labels={labels}
        cronLabels={cronLabels}
        language={language}
        busyAction={busyAction}
        onClose={() => setSelectedAutomationId(null)}
        onSelectRun={(runId) => {
          selectRun(runId);
          setSelectedAutomationId(null);
        }}
        onAction={mutateAutomation}
      />
      <Dialog.Root open={!wideActivityLayout && runDetailOpen && Boolean(selectedRun)} onOpenChange={setRunDetailOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(85vh,40rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
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
              <RunDetailPanel
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

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={cn(
      'rounded-lg border border-edge-subtle bg-surface-base px-4 py-3 shadow-surface',
      tone === 'danger' && 'bg-red-500/10',
    )}>
      <div className="text-xs font-medium uppercase text-fg-muted">{label}</div>
      <div className={cn('mt-1 truncate text-lg font-semibold', tone === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-fg')}>
        {value}
      </div>
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
  onPromptChange,
  onGenerate,
  onPublish,
  onApprovedChange,
  onDiscard,
}: {
  labels: AutomationsMessages;
  prompt: string;
  draft: AutomationDraft | null;
  loading: boolean;
  approved: boolean;
  publishBusy?: boolean;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onPublish: () => void;
  onApprovedChange: (value: boolean) => void;
  onDiscard: () => void;
}) {
  const requiresApproval = Boolean(draft && draft.simulation.requiredConfirmations.length > 0);
  return (
    <section className="rounded-lg border border-edge-subtle bg-surface-base p-4 shadow-surface">
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
        className="mt-4 min-h-20 w-full resize-y rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder={labels.draft.placeholder}
      />
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

function AutomationList({
  automations,
  runs,
  labels,
  cronLabels,
  language,
  busyAction,
  readOnly = false,
  onOpenDetails,
  onAction,
}: {
  automations: Automation[];
  runs: AutomationRun[];
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  busyAction: string | null;
  readOnly?: boolean;
  onOpenDetails: (automationId: string) => void;
  onAction: (actionKey: string, action: () => Promise<unknown>, successTitle?: string) => Promise<boolean>;
}) {
  if (automations.length === 0) {
    return <EmptyState icon={<Zap className="size-5" />} title={labels.empty.automations} />;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {automations.map((automation) => {
        const description = visibleAutomationDescription(automation);
        const recentRuns = runs.filter((run) => run.automationId === automation.id);
        const activeRun = recentRuns.find(isActiveRun);
        const latestRunForAutomation = recentRuns[0];
        const runBusy = busyAction === `automation:${automation.id}:run`;
        const toggleBusy = busyAction === `automation:${automation.id}:toggle`;
        const deleteBusy = busyAction === `automation:${automation.id}:delete`;
        return (
          <article
            key={automation.id}
            className="flex min-h-44 cursor-pointer flex-col rounded-lg border border-edge-subtle bg-surface-base p-3.5 shadow-surface outline-none transition-colors hover:bg-surface-hover"
            role="button"
            tabIndex={0}
            onClick={() => onOpenDetails(automation.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onOpenDetails(automation.id);
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-fg">{automation.name}</span>
                  {activeRun ? <span className="size-2 shrink-0 rounded-full bg-blue-500" /> : null}
                </div>
                {description ? (
                  <div className="mt-1 line-clamp-2 text-sm text-fg-muted">{description}</div>
                ) : null}
              </div>
              <span className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs',
                automation.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-surface-hover text-fg-muted',
              )}>
                {automation.enabled ? labels.enabled : labels.paused}
              </span>
            </div>

            <div className="mt-3 space-y-2 text-sm">
              <div className="flex min-w-0 items-center gap-2 text-fg">
                <span className="shrink-0 text-xs font-medium uppercase text-fg-muted">{labels.info.when}</span>
                <span className="truncate">{triggerLabel(automation.trigger, labels, cronLabels, language)}</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 text-fg-muted">
                <span className="shrink-0 text-xs font-medium uppercase">{labels.info.run}</span>
                <span className="truncate">{actionLabel(automation.action, labels)}</span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              <span>{labels.last}: {formatDate(automation.state.lastRunAtMs, labels, language)}</span>
              <span>{labels.next}: {formatDate(automation.state.nextRunAtMs, labels, language)}</span>
              <span className={cn('rounded-full px-2 py-0.5', statusClass(automation.state.lastRunStatus))}>
                {automation.state.lastRunStatus ? labels.status[automation.state.lastRunStatus] : labels.status.notRun}
              </span>
              {latestRunForAutomation?.error ? (
                <p className="basis-full line-clamp-1 text-red-700 dark:text-red-300">{latestRunForAutomation.error}</p>
              ) : null}
            </div>

            {!readOnly ? (
            <div className="mt-auto flex justify-end pt-3">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  className="size-8 rounded-md p-0"
                  aria-label={labels.dashboard.runNow}
                  disabled={busyAction !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onAction(
                      `automation:${automation.id}:run`,
                      () => automationApi.runNow(automation.id),
                      labels.feedback.rerunQueued,
                    );
                  }}
                >
                  <Play className={cn('size-4', runBusy && 'animate-pulse')} />
                </Button>
                <Button
                  variant="ghost"
                  className="size-8 rounded-md p-0"
                  aria-label={automation.enabled ? labels.dashboard.pause : labels.dashboard.resume}
                  disabled={busyAction !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onAction(
                      `automation:${automation.id}:toggle`,
                      () => automation.enabled ? automationApi.pause(automation.id) : automationApi.resume(automation.id),
                      automation.enabled ? labels.feedback.paused : labels.dashboard.resumed,
                    );
                  }}
                >
                  {toggleBusy ? (
                    <RefreshCw className="size-4 animate-spin" />
                  ) : automation.enabled ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  className="size-8 rounded-md p-0"
                  aria-label={labels.dashboard.delete}
                  disabled={busyAction !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onAction(
                      `automation:${automation.id}:delete`,
                      () => automationApi.remove(automation.id),
                      labels.dashboard.deleted,
                    );
                  }}
                >
                  {deleteBusy ? <RefreshCw className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                </Button>
              </div>
            </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function SystemAutomationSection({
  automations,
  runs,
  labels,
  cronLabels,
  language,
  busyAction,
  onOpenDetails,
  onAction,
}: {
  automations: Automation[];
  runs: AutomationRun[];
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  busyAction: string | null;
  onOpenDetails: (automationId: string) => void;
  onAction: (actionKey: string, action: () => Promise<unknown>, successTitle?: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="mt-5 rounded-lg border border-edge-subtle bg-surface-base shadow-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg">{labels.system.title}</div>
          <div className="mt-1 text-sm text-fg-muted">
            {labels.system.description.replace('{count}', String(automations.length))}
          </div>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-fg-muted transition-transform', expanded && 'rotate-180')} aria-hidden />
      </button>
      {expanded ? (
        <div className="border-t border-edge p-4">
          <AutomationList
            automations={automations}
            runs={runs}
            labels={labels}
            cronLabels={cronLabels}
            language={language}
            busyAction={busyAction}
            readOnly
            onOpenDetails={onOpenDetails}
            onAction={onAction}
          />
        </div>
      ) : null}
    </section>
  );
}

function RunsList({
  runs,
  labels,
  cronLabels,
  language,
  selectedRunId,
  busyAction,
  className,
  onSelectRun,
  onAction,
}: {
  runs: AutomationRun[];
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  selectedRunId: string | null;
  busyAction: string | null;
  className?: string;
  onSelectRun: (runId: string) => void;
  onAction: (actionKey: string, action: () => Promise<unknown>, successTitle?: string) => Promise<boolean>;
}) {
  if (runs.length === 0) return <EmptyState icon={<Activity className="size-5" />} title={labels.empty.runs} />;
  return (
    <div className={cn('overflow-hidden rounded-lg border border-edge-subtle bg-surface-base shadow-surface', className)}>
      {runs.map((run) => (
        <div
          key={run.id}
          className={cn(
            'grid cursor-pointer gap-3 border-b border-edge p-4 outline-none last:border-b-0 hover:bg-surface-hover md:grid-cols-[1fr_auto]',
            selectedRunId === run.id && 'bg-surface-hover',
          )}
          role="button"
          tabIndex={0}
          onClick={() => onSelectRun(run.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onSelectRun(run.id);
          }}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-fg">{run.automationName}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs', statusClass(run.status))}>{labels.status[run.status]}</span>
              {run.workflowRunId ? <span className="text-xs text-fg-muted">{labels.workflowPrefix} {run.workflowRunId.slice(0, 8)}</span> : null}
            </div>
            <div className="mt-1 text-sm text-fg-muted">{run.error || run.summary || actionLabel(run.actionSnapshot, labels)}</div>
            <div className="mt-2 text-xs text-fg-muted">
              {formatDate(run.createdAtMs, labels, language)} · {run.manual ? labels.trigger.manual : triggerLabel(run.triggerSnapshot, labels, cronLabels, language)}
            </div>
          </div>
          {run.status === 'running' || run.status === 'queued' ? (
            <Button
              variant="ghost"
              disabled={busyAction !== null}
              onClick={(event) => {
                event.stopPropagation();
                void onAction(`run:${run.id}:cancel`, () => automationApi.cancelRun(run.id), labels.dashboard.cancelled);
              }}
            >
              {busyAction === `run:${run.id}:cancel` ? labels.feedback.working : labels.cancel}
            </Button>
          ) : null}
        </div>
      ))}
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
    case 'after_run.started':
      return eventLabels.afterRunStarted;
    case 'after_run.completed':
      return eventLabels.afterRunCompleted;
    case 'after_run.failed':
      return eventLabels.afterRunFailed;
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
    <div className="mt-2 rounded-md border border-edge/70 bg-surface-muted/35">
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

function RunDetailPanel({
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
        <div className="mt-3 grid gap-2 text-xs text-fg-muted">
          <DetailLine label={labels.details.created} value={formatDate(run.createdAtMs, labels, language)} />
          <DetailLine label={labels.details.started} value={formatDate(run.startedAtMs, labels, language)} />
          <DetailLine label={labels.details.duration} value={formatDuration(run.durationMs, labels)} />
          {run.model ? <DetailLine label={labels.details.model} value={run.model} /> : null}
        </div>
        <div className="mt-3 rounded-md border border-edge/70 bg-surface-base/50 p-3">
          <div className="text-xs font-semibold uppercase text-fg-muted">{labels.dashboard.result}</div>
          <p className={cn('mt-1 break-words text-sm', needsAttention(run) ? 'text-red-700 dark:text-red-300' : 'text-fg')}>
            {run.error || run.summary || actionLabel(run.actionSnapshot, labels)}
          </p>
          <div className="mt-3 grid gap-2 text-xs text-fg-muted">
            <DetailLine label={labels.explain.whyRan} value={run.manual ? labels.trigger.manual : triggerLabel(run.triggerSnapshot, labels, cronLabels, language)} />
            {run.sessionKey ? (
              <Button asChild variant="secondary" className="h-8 justify-start rounded-md px-2 text-xs">
                <Link to={`/chat/${encodeURIComponent(run.sessionKey)}`}>
                  <ExternalLink className="size-3.5" />
                  {labels.dashboard.openSession}
                </Link>
              </Button>
            ) : null}
            {run.workflowRunId ? (
              <Button asChild variant="secondary" className="h-8 justify-start rounded-md px-2 text-xs">
                <Link to={`/workflows?run=${encodeURIComponent(run.workflowRunId)}`}>
                  <GitBranch className="size-3.5" />
                  {labels.feedback.workflow}
                </Link>
              </Button>
            ) : null}
          </div>
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

      <div className="px-4 py-3">
        <div className="mb-3 text-xs font-semibold uppercase text-fg-muted">{labels.timeline}</div>
        {loading ? (
          <div className="text-sm text-fg-muted">{labels.loading}</div>
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
                    <JsonDetails value={event.data} labels={labels} title={labels.details.eventData} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function AutomationDetailDialog({
  automation,
  runs,
  labels,
  cronLabels,
  language,
  busyAction,
  onClose,
  onSelectRun,
  onAction,
}: {
  automation: Automation | null;
  runs: AutomationRun[];
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
  busyAction: string | null;
  onClose: () => void;
  onSelectRun: (runId: string) => void;
  onAction: (actionKey: string, action: () => Promise<unknown>, successTitle?: string) => Promise<boolean>;
}) {
  const mode = automation ? safetyMode(automation) : 'suggest_only';
  const runBusy = automation ? busyAction === `automation:${automation.id}:run` : false;
  const toggleBusy = automation ? busyAction === `automation:${automation.id}:toggle` : false;
  const deleteBusy = automation ? busyAction === `automation:${automation.id}:delete` : false;

  return (
    <Dialog.Root open={Boolean(automation)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(760px,calc(100vh-2rem))] w-[min(100%-2rem,56rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          {automation ? (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
                <div className="min-w-0">
                  <Dialog.Title className="truncate text-base font-semibold text-fg">{automation.name}</Dialog.Title>
                  {automation.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{automation.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs',
                    automation.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-surface-hover text-fg-muted',
                  )}>
                    {automation.enabled ? labels.enabled : labels.paused}
                  </span>
                  <Dialog.Close asChild>
                    <Button variant="ghost" aria-label={labels.close}>
                      <X className="size-4" />
                    </Button>
                  </Dialog.Close>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
                  <aside className="grid h-fit gap-3 rounded-lg bg-surface-base p-4">
                    <Info label={labels.info.when} value={triggerLabel(automation.trigger, labels, cronLabels, language)} />
                    <Info label={labels.info.run} value={actionLabel(automation.action, labels)} />
                    <Info label={labels.info.safety} value={labels.safety[mode]} />
                    <DetailLine label={labels.last} value={formatDate(automation.state.lastRunAtMs, labels, language)} />
                    <DetailLine label={labels.next} value={formatDate(automation.state.nextRunAtMs, labels, language)} />
                    {automation.state.consecutiveFailures ? (
                      <DetailLine label={labels.dashboard.failures} value={String(automation.state.consecutiveFailures)} />
                    ) : null}
                    {automation.state.lastError ? (
                      <p className="break-words text-sm text-red-700 dark:text-red-300">{automation.state.lastError}</p>
                    ) : null}
                  </aside>

                  <section className="min-w-0">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-fg">{labels.dashboard.runHistory}</h3>
                        <p className="mt-1 text-sm text-fg-muted">{labels.dashboard.runHistoryDescription}</p>
                      </div>
                      <span className="rounded-full bg-surface-base px-2.5 py-1 text-xs text-fg-muted">
                        {runs.length}
                      </span>
                    </div>
                    {runs.length === 0 ? (
                      <EmptyState icon={<Activity className="size-5" />} title={labels.empty.runs} />
                    ) : (
                      <div className="grid gap-2">
                        {runs.map((run) => (
                          <div key={run.id} className="rounded-lg bg-surface-base p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <button
                                className="min-w-0 text-left outline-none"
                                onClick={() => onSelectRun(run.id)}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  {run.status === 'succeeded' ? (
                                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                                  ) : (
                                    <Activity className="size-4 shrink-0 text-fg-muted" />
                                  )}
                                  <span className="truncate text-sm font-medium text-fg">{formatDate(run.createdAtMs, labels, language)}</span>
                                  <span className={cn('rounded-full px-2 py-0.5 text-xs', statusClass(run.status))}>
                                    {labels.status[run.status]}
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-sm text-fg-muted">
                                  {run.error || run.summary || actionLabel(run.actionSnapshot, labels)}
                                </p>
                              </button>
                              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                {run.sessionKey ? (
                                  <Button asChild variant="ghost" className="h-8 rounded-md px-2 text-xs">
                                    <Link to={`/chat/${encodeURIComponent(run.sessionKey)}`}>
                                      <ExternalLink className="size-3.5" />
                                      {labels.dashboard.openSession}
                                    </Link>
                                  </Button>
                                ) : null}
                                {run.workflowRunId ? (
                                  <Button asChild variant="ghost" className="h-8 rounded-md px-2 text-xs">
                                    <Link to={`/workflows?run=${encodeURIComponent(run.workflowRunId)}`}>
                                      <GitBranch className="size-3.5" />
                                      {labels.feedback.workflow}
                                    </Link>
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </div>

              <div className="flex flex-wrap justify-between gap-2 border-t border-edge px-5 py-4">
                <Button
                  variant="ghost"
                  disabled={busyAction !== null}
                  onClick={() => void onAction(
                    `automation:${automation.id}:delete`,
                    () => automationApi.remove(automation.id),
                    labels.dashboard.deleted,
                  ).then((ok) => {
                    if (ok) onClose();
                  })}
                >
                  {deleteBusy ? <RefreshCw className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  {labels.dashboard.delete}
                </Button>
                <div className="flex gap-2">
                  <Button
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
                  </Button>
                  <Button
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
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-edge-subtle bg-surface-base text-fg-muted shadow-surface">
      {icon}
      <div className="mt-2 text-sm">{title}</div>
    </div>
  );
}

function AutomationForm({
  form,
  labels,
  setForm,
  workflowDefinitions,
  selectedWorkflow,
  workflowsLoading,
  agentOptions,
  agentsLoading,
  language,
}: {
  form: FormState;
  labels: AutomationsMessages;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  workflowDefinitions: WorkflowDefinition[];
  selectedWorkflow: WorkflowDefinition | null;
  workflowsLoading: boolean;
  agentOptions: ChatAgentOption[];
  agentsLoading: boolean;
  language: StoredLanguage;
}) {
  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div className="grid gap-4">
        <Field label={labels.form.name}>
          <input className={inputClass} value={form.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label={labels.form.description}>
          <input className={inputClass} value={form.description} onChange={(e) => update({ description: e.target.value })} />
        </Field>
        <Section title={labels.form.trigger} />
        <Select className={inputClass} value={form.triggerMode} onChange={(e) => update({ triggerMode: e.target.value as TriggerMode })}>
          <SelectOption value="manual">{labels.trigger.manual}</SelectOption>
          <SelectOption value="daily">{labels.trigger.daily}</SelectOption>
          <SelectOption value="weekly">{labels.trigger.weekly}</SelectOption>
          <SelectOption value="interval">{labels.trigger.interval}</SelectOption>
          <SelectOption value="cron">{labels.trigger.customCron}</SelectOption>
          <SelectOption value="webhook">{labels.trigger.webhook}</SelectOption>
          <SelectOption value="goalBlocked">{labels.trigger.goalBlocked}</SelectOption>
          <SelectOption value="noteCreated">{labels.trigger.noteCreated}</SelectOption>
          <SelectOption value="workflowFailed">{labels.trigger.workflowFailed}</SelectOption>
          <SelectOption value="sessionUpdated">{labels.trigger.sessionUpdated}</SelectOption>
        </Select>
        {form.triggerMode === 'daily' || form.triggerMode === 'weekly' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={labels.form.time}><input className={inputClass} type="time" value={form.time} onChange={(e) => update({ time: e.target.value })} /></Field>
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
          <Field label={labels.form.everyMinutes}>
            <input className={inputClass} inputMode="numeric" value={form.intervalMinutes} onChange={(e) => update({ intervalMinutes: e.target.value })} />
          </Field>
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

        <Section title={labels.form.action} />
        <Select
          className={inputClass}
          value={form.actionMode}
          onChange={(e) => {
            const actionMode = e.target.value as ActionMode;
            update({
              actionMode,
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
        </Select>
        <Field label={labels.form.agent}>
          <Select
            className={inputClass}
            value={form.agentId}
            onChange={(e) => update({ agentId: e.target.value })}
          >
            <SelectOption value="">{agentsLoading ? labels.form.loadingAgents : labels.form.defaultAgent}</SelectOption>
            {agentOptions.map((agent) => (
              <SelectOption key={agent.id} value={agent.id}>
                {agent.name || agent.id}
              </SelectOption>
            ))}
          </Select>
        </Field>
        {form.actionMode === 'agent' ? (
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
                }}
                showLabel={false}
              />
            </div>
            <textarea className={cn(inputClass, 'min-h-32 resize-y')} value={form.instruction} onChange={(e) => update({ instruction: e.target.value })} />
          </Field>
        ) : (
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
        )}

        <Section title={labels.form.safety} />
        <Field label={labels.form.safety}>
          <Select
            className={inputClass}
            value={form.safetyMode}
            onChange={(e) => {
              const safetyMode = e.target.value as AutomationSafetyMode;
              update({
                safetyMode,
                ...(safetyMode !== 'auto_apply' && form.afterRunMode === 'webhook'
                  ? { afterRunMode: 'none' as const, webhookUrl: '' }
                  : {}),
              });
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
        </Field>

        <Section title={labels.form.afterRun} />
        <Select className={inputClass} value={form.afterRunMode} onChange={(e) => update({ afterRunMode: e.target.value as FormState['afterRunMode'] })}>
          <SelectOption value="none">{labels.afterRun.none}</SelectOption>
          <SelectOption value="saveToSession">{labels.afterRun.saveToSession}</SelectOption>
          <SelectOption value="webhook" disabled={form.safetyMode !== 'auto_apply'}>{labels.afterRun.webhook}</SelectOption>
        </Select>
        {form.afterRunMode === 'webhook' ? (
          <Field label={labels.form.webhookUrl}>
            <input className={inputClass} value={form.webhookUrl} onChange={(e) => update({ webhookUrl: e.target.value })} />
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
      </div>
    </div>
  );
}

const inputClass = 'w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 pt-2 text-sm font-semibold text-fg">
      <GitBranch className="size-4 text-fg-muted" />
      {title}
    </div>
  );
}
