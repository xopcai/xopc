import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  GitBranch,
  ListTree,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/markdown/markdown-view';
import { RefreshButton } from '@/components/ui/refresh-button';
import { Skeleton } from '@/components/ui/skeleton';
import { TimePicker } from '@/components/ui/time-picker';
import { AiTextAssistButton } from '@/features/ai-assist/ai-text-assist-button';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { messages, type MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';
import { showToast } from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { listWorkflowDefinitions, type WorkflowDefinition } from '@/features/workflows/workflow-api';
import { browserWorkflowApi, type BrowserWorkflow } from '@/features/browser-workflows/browser-workflow-api';
import {
  BrowserWorkflowInputFields,
  browserWorkflowInputsComplete,
  defaultBrowserWorkflowInputs,
} from '@/features/browser-workflows/browser-workflow-inputs';
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

type CreateMode = 'blank' | 'draft' | 'template';
type ViewTab = 'activity' | 'automations' | 'system';
type AutomationsMessages = MessageBundle['automations'];
type CronMessages = MessageBundle['cron'];
type RunEventLabels = AutomationsMessages['events'];

function formatDate(ms: number | undefined, labels: AutomationsMessages, language: StoredLanguage): string {
  if (!ms) return labels.never;
  return formatAutomationDateTime(ms, language);
}

function actionLabel(action: AutomationAction, labels: AutomationsMessages): string {
  if (action.kind === 'workflow') return labels.action.workflowWithId.replace('{id}', action.workflowId);
  if (action.kind === 'browser_recipe') return `Browser automation: ${action.recipeId}`;
  return action.agentId ? labels.action.agentWithId.replace('{id}', action.agentId) : labels.action.agent;
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

function AutomationsPageSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_26rem]">
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

export function AutomationsPage() {
  const language = useLocaleStore((s) => s.language);
  const messageBundle = messages(language);
  const labels = messageBundle.automations;
  const cronLabels = messageBundle.cron;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const [searchParams, setSearchParams] = useSearchParams();
  const runParam = searchParams.get('run')?.trim() ?? '';
  const automationParam = searchParams.get('automation')?.trim() ?? '';
  const draftParam = searchParams.get('draft')?.trim() ?? '';
  const actionParam = searchParams.get('action')?.trim() ?? '';
  const projectIdParam = searchParams.get('projectId')?.trim() ?? '';
  const autogenerateDraft = searchParams.get('autogenerate') === '1';
  const insightParam = searchParams.get('insight')?.trim() ?? '';
  const draftSeedRef = useRef('');
  const wideActivityLayout = useMediaQuery('(min-width: 1280px)');
  const [viewTab, setViewTab] = useState<ViewTab>('activity');
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
  const browserWorkflowsSwr = useSWR('automation-browser-workflows', () => browserWorkflowApi.list());
  const chatAgentsSwr = useSWR('automation-chat-agents', fetchChatAgents);
  const initialLoading =
    (automationsSwr.isLoading && !automationsSwr.data) ||
    (runsSwr.isLoading && !runsSwr.data) ||
    (metricsSwr.isLoading && !metricsSwr.data);

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
  const editingAutomation = useMemo(
    () => automations.find((automation) => automation.id === editingAutomationId) ?? null,
    [automations, editingAutomationId],
  );
  const selectedAutomationRuns = useMemo(
    () => runs.filter((run) => run.automationId === selectedAutomationId),
    [runs, selectedAutomationId],
  );
  const runEvents = runEventsSwr.data?.events ?? [];
  const attentionRuns = useMemo(() => userRuns.filter(needsAttention), [userRuns]);
  const latestRun = userRuns[0] ?? null;
  const workflowDefinitions = useMemo(() => workflowDefinitionsSwr.data ?? [], [workflowDefinitionsSwr.data]);
  const browserWorkflows = useMemo(
    () => (browserWorkflowsSwr.data?.workflows ?? []).filter((workflow) => workflow.enabled),
    [browserWorkflowsSwr.data],
  );
  const agentOptions = chatAgentsSwr.data?.items ?? [];
  const selectedWorkflow = useMemo(
    () => workflowDefinitions.find((workflow) => workflow.id === form.workflowId.trim()) ?? null,
    [form.workflowId, workflowDefinitions],
  );
  const selectedBrowserWorkflow = useMemo(
    () => browserWorkflows.find((workflow) => workflow.id === form.browserWorkflowId.trim()) ?? null,
    [browserWorkflows, form.browserWorkflowId],
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
    (form.triggerMode !== 'once' || Number.isFinite(new Date(form.onceAt).getTime())) &&
    (form.triggerMode !== 'event' || (Boolean(form.eventType.trim()) && payloadMatchIsValid(form.eventPayloadMatch))) &&
    (form.actionMode === 'workflow'
      ? !workflowSelectionInvalid && !workflowInputInvalid
      : form.actionMode === 'browser_recipe'
        ? selectedBrowserWorkflow !== null && browserWorkflowInputsComplete(selectedBrowserWorkflow, form.browserWorkflowInputs)
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
        name: labels.templates.blockedOutcome.name,
        description: labels.templates.blockedOutcome.description,
        form: {
          ...initialForm,
          name: labels.templates.blockedOutcome.formName,
          triggerMode: 'outcomeBlocked' as const,
          instruction: labels.templates.blockedOutcome.instruction,
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

  useEffect(() => {
    if (viewTab !== 'activity' || userRuns.length === 0) return;
    if (selectedRunId && userRuns.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(userRuns[0].id);
  }, [selectedRunId, userRuns, viewTab]);

  const reload = useCallback(async () => {
    await Promise.all([automationsSwr.mutate(), runsSwr.mutate(), metricsSwr.mutate(), runEventsSwr.mutate()]);
  }, [automationsSwr.mutate, metricsSwr.mutate, runEventsSwr.mutate, runsSwr.mutate]);

  const openCreate = useCallback((mode: CreateMode) => {
    setEditingAutomationId(null);
    setEditingDraft(false);
    setCreateMode(mode);
    setCreateOpen(true);
    if (mode === 'blank') setForm(initialForm);
  }, []);

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
    setForm(formFromAutomation(draft.automation, workflowDefinitions));
    setEditingAutomationId(null);
    setEditingDraft(true);
    setCreateMode('blank');
  }, [draft, workflowDefinitions]);

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
    if (!automationParam) return;
    const automation = automations.find((item) => item.id === automationParam);
    if (!automation) return;
    setViewTab(isSystemManagedAutomation(automation) ? 'system' : 'automations');
    setSelectedAutomationId(automation.id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('automation');
      return next;
    }, { replace: true });
  }, [automationParam, automations, setSearchParams]);

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
      next.delete('insight');
      return next;
    }, { replace: true });
    if (!autogenerateDraft) return;
    setError(null);
    setDraftLoading(true);
    void automationApi.draft({ prompt: draftParam, language })
      .then((result) => {
        setDraft(result.draft);
        setDraftApproved(false);
        if (insightParam) void automationApi.completeInsightDraft(insightParam);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setDraftLoading(false);
      });
  }, [autogenerateDraft, draftParam, insightParam, language, setSearchParams]);

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
    if (editingDraft && draft) {
      setBusyAction('draft:edit');
      try {
        const automation = buildInput(form, selectedWorkflow);
        const { simulation } = await automationApi.simulate(automation);
        setDraft({ ...draft, automation, simulation });
        setDraftApproved(false);
        setEditingDraft(false);
        setCreateMode('draft');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        showToast({ type: 'error', title: labels.feedback.actionFailed, message });
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (editingAutomation) {
      const automationId = editingAutomation.id;
      const updated = await mutateAutomation(`automation:${automationId}:edit`, () => (
        automationApi.update(automationId, buildAutomationEditInput(editingAutomation, form, selectedWorkflow))
      ));
      if (updated) {
        setCreateOpen(false);
        setEditingAutomationId(null);
        setSelectedAutomationId(automationId);
      }
      return;
    }
    try {
      await automationApi.create({
        ...buildInput(form, selectedWorkflow),
        ...(projectIdParam ? { projectId: projectIdParam } : {}),
      });
      setForm(initialForm);
      setCreateOpen(false);
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      showToast({ type: 'error', title: labels.feedback.actionFailed, message });
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
    });
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
            { id: 'system' as const, label: labels.system.title, count: systemAutomations.length },
          ]).map((item) => (
            <button
              type="button"
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

        {initialLoading ? (
          <AutomationsPageSkeleton />
        ) : viewTab === 'activity' ? (
          <section className="grid items-start gap-4 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
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
              className="hidden xl:sticky xl:top-4 xl:block"
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
        ) : viewTab === 'automations' ? (
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
          </section>
        ) : (
          <section>
            <AutomationList
              automations={systemAutomations}
              runs={runs}
              labels={labels}
              cronLabels={cronLabels}
              language={language}
              busyAction={busyAction}
              readOnly
              onOpenDetails={setSelectedAutomationId}
              onAction={mutateAutomation}
            />
          </section>
        )}
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
          <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(760px,calc(100vh-2rem))] w-[min(100%-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
            <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">
                {createMode === 'draft'
                  ? labels.draft.title
                  : createMode === 'template'
                    ? labels.createMenu.templatesTitle
                    : editingAutomation
                      ? labels.editTitle
                      : editingDraft
                        ? labels.draft.editTitle
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
                  onEdit={openDraftEditor}
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
                      type="button"
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
                  browserWorkflows={browserWorkflows}
                  selectedBrowserWorkflow={selectedBrowserWorkflow}
                  browserWorkflowsLoading={browserWorkflowsSwr.isLoading}
                  agentOptions={agentOptions}
                  agentsLoading={chatAgentsSwr.isLoading}
                  language={language}
                />
                <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
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
                    disabled={!formCanSubmit || busyAction === 'draft:edit' || Boolean(editingAutomation && busyAction)}
                  >
                    {busyAction === 'draft:edit' || (editingAutomation && busyAction === `automation:${editingAutomation.id}:edit`)
                      ? labels.feedback.working
                      : editingAutomation || editingDraft
                        ? labels.save
                        : labels.create}
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
        onEdit={openAutomationEditor}
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
  onEdit,
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
  onEdit: () => void;
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
              <Button variant="secondary" onClick={onEdit}>
                <Pencil className="size-4" />
                {labels.draft.edit}
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
                <span className="truncate">{automationTriggerLabel(automation.trigger, labels, cronLabels, language)}</span>
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
            <div className={cn(
              'mt-1 line-clamp-2 whitespace-pre-line text-sm text-fg-muted',
              run.error && 'text-red-700 dark:text-red-300',
            )}>
              {run.error
                || run.summary
                || (isActiveRun(run) ? labels.runDetail.resultPending : labels.runDetail.noResult)}
            </div>
            <div className="mt-2 text-xs text-fg-muted">
              {formatDate(run.createdAtMs, labels, language)} · {run.manual ? labels.trigger.manual : automationTriggerLabel(run.triggerSnapshot, labels, cronLabels, language)}
            </div>
          </div>
          {run.status === 'running' || run.status === 'queued' || run.status === 'cancelling' ? (
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

  const result = run.error || run.summary;
  const processLink = run.sessionKey
    ? `/chat/${encodeURIComponent(run.sessionKey)}`
    : run.workflowRunId
      ? `/workflows?run=${encodeURIComponent(run.workflowRunId)}`
      : null;
  const processLabel = run.sessionKey ? labels.runDetail.openConversation : labels.runDetail.openWorkflow;
  const ProcessIcon = run.sessionKey ? MessageCircle : GitBranch;
  const ResultIcon = isActiveRun(run) ? Activity : needsAttention(run) ? CircleAlert : CheckCircle2;

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
              isActiveRun(run) ? 'text-blue-500' : needsAttention(run) ? 'text-red-500' : 'text-emerald-500',
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
          'mt-3 max-h-80 overflow-y-auto rounded-lg border border-edge/70 bg-surface-muted/25 p-3',
          run.error && 'border-red-500/25 bg-red-500/5',
        )}>
          {result ? (
            run.error ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-red-700 dark:text-red-300">{result}</p>
            ) : (
              <MarkdownView content={result} compact className="text-sm" openHttpLinksInNewTab />
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
                      <details className="group/event mt-2 rounded-md border border-edge/70 bg-surface-muted/35">
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

function AutomationDetailDialog({
  automation,
  runs,
  labels,
  cronLabels,
  language,
  busyAction,
  onClose,
  onEdit,
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
  onEdit: (automation: Automation) => void;
  onSelectRun: (runId: string) => void;
  onAction: (actionKey: string, action: () => Promise<unknown>, successTitle?: string) => Promise<boolean>;
}) {
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
                <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
                  <AutomationOverview
                    automation={automation}
                    labels={labels}
                    cronLabels={cronLabels}
                    language={language}
                  />

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
                                type="button"
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
                  {!isSystemManagedAutomation(automation) ? (
                    <Button
                      variant="secondary"
                      disabled={busyAction !== null}
                      onClick={() => onEdit(automation)}
                    >
                      <Pencil className="size-4" />
                      {labels.edit}
                    </Button>
                  ) : null}
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
}: {
  automation: Automation;
  labels: AutomationsMessages;
  cronLabels: CronMessages;
  language: StoredLanguage;
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
            : automation.action.kind === 'browser_recipe'
              ? <ListTree className="size-4" aria-hidden />
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
  browserWorkflows,
  selectedBrowserWorkflow,
  browserWorkflowsLoading,
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
  browserWorkflows: BrowserWorkflow[];
  selectedBrowserWorkflow: BrowserWorkflow | null;
  browserWorkflowsLoading: boolean;
  agentOptions: ChatAgentOption[];
  agentsLoading: boolean;
  language: StoredLanguage;
}) {
  const agentsMessages = messages(language).agentsSettings;
  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));
  const intervalMs = automationIntervalMs(form.intervalValue, form.intervalUnit);
  const intervalPreviewNow = Date.now();
  const intervalPreviewTimes = [1, 2, 3].map((step) => (
    formatAutomationRelativeDateTime(intervalPreviewNow + intervalMs * step, language, intervalPreviewNow)
  ));

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
    if (form.actionMode !== 'browser_recipe') return;
    if (form.browserWorkflowId.trim()) return;
    const first = browserWorkflows[0];
    if (!first) return;
    setForm((prev) => ({
      ...prev,
      browserWorkflowId: first.id,
      browserWorkflowInputs: defaultBrowserWorkflowInputs(first),
    }));
  }, [browserWorkflows, form.actionMode, form.browserWorkflowId, setForm]);

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
          <SelectOption value="once">{labels.trigger.once}</SelectOption>
          <SelectOption value="daily">{labels.trigger.daily}</SelectOption>
          <SelectOption value="weekly">{labels.trigger.weekly}</SelectOption>
          <SelectOption value="interval">{labels.trigger.interval}</SelectOption>
          <SelectOption value="cron">{labels.trigger.customCron}</SelectOption>
          <SelectOption value="webhook">{labels.trigger.webhook}</SelectOption>
          <SelectOption value="outcomeBlocked">{labels.trigger.outcomeBlocked}</SelectOption>
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

        <Section title={labels.form.action} />
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
                ? { timeoutSeconds: actionMode === 'browser_recipe' ? '600' : '1800' }
                : {}),
              ...(actionMode === 'browser_recipe' ? { safetyMode: 'auto_apply' as const } : {}),
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
          <SelectOption value="browser_recipe">{language === 'zh' ? '浏览器自动化' : 'Browser automation'}</SelectOption>
        </Select>
        {form.actionMode !== 'browser_recipe' ? <Field label={labels.form.agent}>
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
        ) : (
          <>
            <Field label={language === 'zh' ? '浏览器自动化' : 'Browser automation'}>
              <Select
                className={inputClass}
                value={form.browserWorkflowId}
                onChange={(event) => {
                  const workflow = browserWorkflows.find((item) => item.id === event.target.value);
                  update({
                    browserWorkflowId: event.target.value,
                    browserWorkflowInputs: workflow ? defaultBrowserWorkflowInputs(workflow) : {},
                  });
                }}
                disabled={browserWorkflowsLoading || browserWorkflows.length === 0}
              >
                {browserWorkflows.length === 0 ? <SelectOption value="">{language === 'zh' ? '没有已启用的浏览器自动化' : 'No enabled browser automations'}</SelectOption> : null}
                {browserWorkflows.map((workflow) => <SelectOption key={workflow.id} value={workflow.id}>{workflow.name}</SelectOption>)}
              </Select>
            </Field>
            {selectedBrowserWorkflow && Object.keys(selectedBrowserWorkflow.inputs).length > 0 ? <Field label={language === 'zh' ? '运行时填写' : 'Run inputs'}><BrowserWorkflowInputFields workflow={selectedBrowserWorkflow} values={form.browserWorkflowInputs} language={language} onChange={(browserWorkflowInputs) => update({ browserWorkflowInputs })} /></Field> : null}
          </>
        )}

        {form.actionMode !== 'browser_recipe' ? <><Section title={labels.form.safety} />
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
        </Field></> : null}

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
        <div className="rounded-lg border border-edge bg-surface-muted/40 px-3 py-2.5">
          <p className="text-xs font-medium text-fg">{labels.form.effectivePolicy}</p>
          <p className="mt-1 text-xs text-fg-muted">
            {labels.form.executionDeadline}: {form.timeoutSeconds || '—'}s
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-subtle">
            {labels.form.downstreamTimeoutHint}
          </p>
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
