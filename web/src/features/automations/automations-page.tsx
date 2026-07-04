import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, GitBranch, Pause, Play, Plus, RefreshCw, Sparkles, Trash2, X, Zap } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { AiTextAssistButton } from '@/features/ai-assist/ai-text-assist-button';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { messages, type MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';
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

type Tab = 'automations' | 'runs' | 'templates';
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

function formatDate(ms: number | undefined, labels: AutomationsMessages): string {
  if (!ms) return labels.never;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function triggerLabel(trigger: AutomationTrigger, labels: AutomationsMessages): string {
  if (trigger.kind === 'manual') return labels.trigger.manual;
  if (trigger.kind === 'webhook') return labels.trigger.webhook;
  if (trigger.kind === 'event') return labels.trigger.eventWithType.replace('{type}', trigger.eventType);
  const schedule = trigger.schedule;
  if (schedule.kind === 'once') return labels.trigger.onceAt.replace('{time}', formatDate(Date.parse(schedule.at), labels));
  if (schedule.kind === 'interval') return labels.trigger.everyMinutes.replace('{minutes}', String(Math.round(schedule.everyMs / 60000)));
  return schedule.expr;
}

function actionLabel(action: AutomationAction, labels: AutomationsMessages): string {
  if (action.kind === 'workflow') return labels.action.workflowWithId.replace('{id}', action.workflowId);
  return action.agentId ? labels.action.agentWithId.replace('{id}', action.agentId) : labels.action.agent;
}

function safetyMode(automation: Automation): AutomationSafetyMode {
  return automation.safety?.mode ?? 'auto_apply';
}

function nextSafetyMode(mode: AutomationSafetyMode): AutomationSafetyMode | null {
  if (mode === 'suggest_only') return 'ask_before_apply';
  if (mode === 'ask_before_apply') return 'auto_apply';
  return null;
}

function previousSafetyMode(mode: AutomationSafetyMode): AutomationSafetyMode | null {
  if (mode === 'auto_apply') return 'ask_before_apply';
  if (mode === 'ask_before_apply') return 'suggest_only';
  return null;
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
  const labels = messages(language).automations;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const [searchParams, setSearchParams] = useSearchParams();
  const runParam = searchParams.get('run')?.trim() ?? '';
  const draftParam = searchParams.get('draft')?.trim() ?? '';
  const autogenerateDraft = searchParams.get('autogenerate') === '1';
  const draftSeedRef = useRef('');
  const [tab, setTab] = useState<Tab>('automations');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftApproved, setDraftApproved] = useState(false);
  const [repairDraft, setRepairDraft] = useState<AutomationRepairDraft | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairApproved, setRepairApproved] = useState(false);

  const automationsSwr = useSWR('automations', () => automationApi.list(), { refreshInterval: 15_000 });
  const runsSwr = useSWR('automation-runs', () => automationApi.runs(50), { refreshInterval: 10_000 });
  const metricsSwr = useSWR('automation-metrics', () => automationApi.metrics(), { refreshInterval: 15_000 });
  const runEventsSwr = useSWR(
    selectedRunId ? `automation-run-events:${selectedRunId}` : null,
    () => automationApi.runEvents(selectedRunId!),
    { refreshInterval: 5_000 },
  );
  const workflowDefinitionsSwr = useSWR('automation-workflow-definitions', listWorkflowDefinitions);
  const chatAgentsSwr = useSWR('automation-chat-agents', fetchChatAgents);

  const automations = automationsSwr.data?.automations ?? [];
  const runs = runsSwr.data?.runs ?? [];
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const runEvents = runEventsSwr.data?.events ?? [];
  const metrics = metricsSwr.data;
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

  useEffect(() => {
    if (!runParam) return;
    setSelectedRunId(runParam);
    setTab('runs');
  }, [runParam]);

  useEffect(() => {
    if (!draftParam) return;
    const marker = `${language}:${autogenerateDraft ? 'auto' : 'seed'}:${draftParam}`;
    if (draftSeedRef.current === marker) return;
    draftSeedRef.current = marker;
    setDraftPrompt(draftParam);
    setDraft(null);
    setDraftApproved(false);
    setTab('automations');
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
    setTab('runs');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('run', runId);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    setRepairDraft(null);
    setRepairApproved(false);
  }, [selectedRunId]);

  async function submitForm() {
    setError(null);
    if (!formCanSubmit) return;
    try {
      await automationApi.create(buildInput(form, selectedWorkflow));
      setForm(initialForm);
      setFormOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function mutateAutomation(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    await mutateAutomation(async () => {
      await automationApi.create(draft.automation);
      setDraft(null);
      setDraftPrompt('');
      setDraftApproved(false);
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
    await mutateAutomation(async () => {
      await automationApi.update(run.automationId, repairDraft.patch);
      setRepairDraft(null);
      setRepairApproved(false);
    });
  }

  const headerEnd = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={reload} aria-label={labels.refresh}>
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          <Plus className="size-4" />
          {labels.new}
        </Button>
      </div>
    ),
    [labels.new, labels.refresh, reload],
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
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-base">
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-5 px-4 py-6">
        <DraftPanel
          labels={labels}
          prompt={draftPrompt}
          draft={draft}
          loading={draftLoading}
          approved={draftApproved}
          onPromptChange={setDraftPrompt}
          onGenerate={generateDraft}
          onPublish={publishDraft}
          onApprovedChange={setDraftApproved}
          onDiscard={() => {
            setDraft(null);
            setDraftApproved(false);
          }}
        />

        <section className="grid gap-3 sm:grid-cols-4">
          <Metric label={labels.metrics.total} value={metrics?.totalAutomations ?? automations.length} />
          <Metric label={labels.metrics.enabled} value={metrics?.enabledAutomations ?? automations.filter((a) => a.enabled).length} />
          <Metric label={labels.metrics.running} value={metrics?.runningRuns ?? runs.filter((r) => r.status === 'running').length} />
          <Metric label={labels.metrics.next} value={metrics?.nextRun ? formatDate(metrics.nextRun.runAtMs, labels) : labels.none} />
        </section>

        <nav className="inline-flex w-fit rounded-lg border border-edge bg-surface-panel p-1">
          {(['automations', 'runs', 'templates'] as const).map((item) => (
            <button
              key={item}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium capitalize text-fg-muted',
                tab === item && 'bg-surface-hover text-fg',
              )}
              onClick={() => setTab(item)}
            >
              {labels.tabs[item]}
            </button>
          ))}
        </nav>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {tab === 'automations' ? (
          <AutomationList automations={automations} labels={labels} onAction={mutateAutomation} />
        ) : tab === 'runs' ? (
          <div className="grid min-h-[28rem] gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <RunsList
                runs={runs}
                labels={labels}
                selectedRunId={selectedRunId}
                onSelectRun={selectRun}
                onAction={mutateAutomation}
              />
            <RunDetailPanel
              run={selectedRun}
              events={runEvents}
              labels={labels}
              loading={runEventsSwr.isLoading}
              repairDraft={repairDraft}
              repairLoading={repairLoading}
              repairApproved={repairApproved}
              onRepairApprovedChange={setRepairApproved}
              onSuggestRepair={generateRepairDraft}
              onApplyRepair={applyRepairDraft}
            />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {templates.map((template) => (
              <button
                key={template.name}
                className="rounded-lg border border-edge bg-surface-panel p-4 text-left hover:bg-surface-hover"
                onClick={() => {
                  setForm(template.form);
                  setFormOpen(true);
                }}
              >
                <div className="font-medium text-fg">{template.name}</div>
                <div className="mt-2 text-sm text-fg-muted">{template.description}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog.Root open={formOpen} onOpenChange={(next) => !next && setFormOpen(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(720px,calc(100vh-2rem))] w-[min(100%-2rem,42rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
            <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{labels.createTitle}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" aria-label={labels.close}>
                <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-panel px-4 py-3">
      <div className="text-xs font-medium uppercase text-fg-muted">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-fg">{value}</div>
    </div>
  );
}

function DraftPanel({
  labels,
  prompt,
  draft,
  loading,
  approved,
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
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onPublish: () => void;
  onApprovedChange: (value: boolean) => void;
  onDiscard: () => void;
}) {
  const requiresApproval = Boolean(draft && draft.simulation.requiredConfirmations.length > 0);
  return (
    <section className="rounded-lg border border-edge bg-surface-panel p-4">
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
        <div className="mt-4 grid gap-3 rounded-lg border border-edge bg-surface-base p-4 lg:grid-cols-[1fr_1fr]">
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
              <Button variant="primary" onClick={onPublish} disabled={requiresApproval && !approved}>{labels.draft.publish}</Button>
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
  labels,
  onAction,
}: {
  automations: Automation[];
  labels: AutomationsMessages;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
}) {
  if (automations.length === 0) {
    return <EmptyState icon={<Zap className="size-5" />} title={labels.empty.automations} />;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-panel">
      {automations.map((automation) => {
        const mode = safetyMode(automation);
        const upgradeMode = nextSafetyMode(mode);
        const downgradeMode = previousSafetyMode(mode);
        return (
        <div key={automation.id} className="grid gap-3 border-b border-edge p-4 last:border-b-0 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-fg">{automation.name}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs', automation.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-surface-hover text-fg-muted')}>
                {automation.enabled ? labels.enabled : labels.paused}
              </span>
              <span className="rounded-full border border-edge bg-surface-muted px-2 py-0.5 text-xs text-fg-muted">
                {labels.safety[mode]}
              </span>
            </div>
            {automation.description ? <div className="mt-1 truncate text-sm text-fg-muted">{automation.description}</div> : null}
          </div>
          <Info label={labels.info.when} value={triggerLabel(automation.trigger, labels)} />
          <Info label={labels.info.run} value={actionLabel(automation.action, labels)} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {downgradeMode ? (
              <Button
                variant="ghost"
                className="h-8 rounded-md px-2 text-xs"
                onClick={() => onAction(() => automationApi.update(automation.id, { safety: { mode: downgradeMode } }))}
              >
                {labels.safety.downgrade}
              </Button>
            ) : null}
            {upgradeMode ? (
              <Button
                variant="secondary"
                className="h-8 rounded-md px-2 text-xs"
                onClick={() => onAction(() => automationApi.update(automation.id, { safety: { mode: upgradeMode } }))}
              >
                {labels.safety.upgrade}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onAction(() => automationApi.runNow(automation.id))}>
              <Play className="size-4" />
            </Button>
            <Button variant="ghost" onClick={() => onAction(() => automation.enabled ? automationApi.pause(automation.id) : automationApi.resume(automation.id))}>
              {automation.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Button variant="ghost" onClick={() => onAction(() => automationApi.remove(automation.id))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="lg:col-span-4 grid gap-2 text-xs text-fg-muted sm:grid-cols-3">
            <span>{labels.last}: {formatDate(automation.state.lastRunAtMs, labels)}</span>
            <span>{labels.next}: {formatDate(automation.state.nextRunAtMs, labels)}</span>
            <span className={cn('w-fit rounded-full px-2 py-0.5', statusClass(automation.state.lastRunStatus))}>
              {automation.state.lastRunStatus ? labels.status[automation.state.lastRunStatus] : labels.status.notRun}
            </span>
          </div>
        </div>
        );
      })}
    </div>
  );
}

function RunsList({
  runs,
  labels,
  selectedRunId,
  onSelectRun,
  onAction,
}: {
  runs: AutomationRun[];
  labels: AutomationsMessages;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
}) {
  if (runs.length === 0) return <EmptyState icon={<Activity className="size-5" />} title={labels.empty.runs} />;
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-panel">
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
              {formatDate(run.createdAtMs, labels)} · {run.manual ? labels.trigger.manual : triggerLabel(run.triggerSnapshot, labels)}
            </div>
          </div>
          {run.status === 'running' || run.status === 'queued' ? (
            <Button
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                void onAction(() => automationApi.cancelRun(run.id));
              }}
            >
              {labels.cancel}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RunDetailPanel({
  run,
  events,
  labels,
  loading,
  repairDraft,
  repairLoading,
  repairApproved,
  onRepairApprovedChange,
  onSuggestRepair,
  onApplyRepair,
}: {
  run: AutomationRun | null;
  events: AutomationRunEvent[];
  labels: AutomationsMessages;
  loading: boolean;
  repairDraft: AutomationRepairDraft | null;
  repairLoading: boolean;
  repairApproved: boolean;
  onRepairApprovedChange: (value: boolean) => void;
  onSuggestRepair: (run: AutomationRun) => void;
  onApplyRepair: (run: AutomationRun) => void;
}) {
  if (!run) {
    return (
      <aside className="flex min-h-64 flex-col justify-center rounded-lg border border-edge bg-surface-panel px-4 text-center text-sm text-fg-muted">
        <Activity className="mx-auto size-5" />
        <div className="mt-2">{labels.selectRun}</div>
      </aside>
    );
  }

  return (
    <aside className="rounded-lg border border-edge bg-surface-panel">
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
          <DetailLine label={labels.details.created} value={formatDate(run.createdAtMs, labels)} />
          <DetailLine label={labels.details.started} value={formatDate(run.startedAtMs, labels)} />
          <DetailLine label={labels.details.duration} value={formatDuration(run.durationMs, labels)} />
          {run.model ? <DetailLine label={labels.details.model} value={run.model} /> : null}
          {run.sessionKey ? <DetailLine label={labels.details.session} value={run.sessionKey} /> : null}
          {run.workflowRunId ? <DetailLine label={labels.workflowPrefix} value={run.workflowRunId} /> : null}
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
          <pre className="mt-3 max-h-36 overflow-auto rounded-md bg-surface-base p-2 text-xs text-fg-muted">
            {JSON.stringify(repairDraft.patch, null, 2)}
          </pre>
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
              disabled={repairDraft.requiresApproval && !repairApproved}
            >
              {labels.repair.apply}
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
                  <div className="text-sm text-fg">{event.message}</div>
                  <div className="mt-1 text-xs text-fg-muted">
                    {formatDate(event.createdAtMs, labels)} · {event.type}
                  </div>
                  {event.data && typeof event.data === 'object' ? (
                    <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-surface-base p-2 text-xs text-fg-muted">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
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
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-edge bg-surface-panel text-fg-muted">
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
        <select className={inputClass} value={form.triggerMode} onChange={(e) => update({ triggerMode: e.target.value as TriggerMode })}>
          <option value="manual">{labels.trigger.manual}</option>
          <option value="daily">{labels.trigger.daily}</option>
          <option value="weekly">{labels.trigger.weekly}</option>
          <option value="interval">{labels.trigger.interval}</option>
          <option value="cron">{labels.trigger.customCron}</option>
          <option value="webhook">{labels.trigger.webhook}</option>
          <option value="goalBlocked">{labels.trigger.goalBlocked}</option>
          <option value="noteCreated">{labels.trigger.noteCreated}</option>
          <option value="workflowFailed">{labels.trigger.workflowFailed}</option>
          <option value="sessionUpdated">{labels.trigger.sessionUpdated}</option>
        </select>
        {form.triggerMode === 'daily' || form.triggerMode === 'weekly' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={labels.form.time}><input className={inputClass} type="time" value={form.time} onChange={(e) => update({ time: e.target.value })} /></Field>
            {form.triggerMode === 'weekly' ? (
              <Field label={labels.form.day}>
                <select className={inputClass} value={form.weekday} onChange={(e) => update({ weekday: e.target.value })}>
                  <option value="1">{labels.weekdays.monday}</option>
                  <option value="2">{labels.weekdays.tuesday}</option>
                  <option value="3">{labels.weekdays.wednesday}</option>
                  <option value="4">{labels.weekdays.thursday}</option>
                  <option value="5">{labels.weekdays.friday}</option>
                  <option value="6">{labels.weekdays.saturday}</option>
                  <option value="0">{labels.weekdays.sunday}</option>
                </select>
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
        <select
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
          <option value="agent">{labels.action.runAgent}</option>
          <option value="workflow">{labels.action.runWorkflow}</option>
        </select>
        <Field label={labels.form.agent}>
          <select
            className={inputClass}
            value={form.agentId}
            onChange={(e) => update({ agentId: e.target.value })}
          >
            <option value="">{agentsLoading ? labels.form.loadingAgents : labels.form.defaultAgent}</option>
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name || agent.id}
              </option>
            ))}
          </select>
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
              <select
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
                {workflowsLoading ? <option value="">{labels.form.loadingWorkflows}</option> : null}
                {!workflowsLoading && workflowDefinitions.length === 0 ? <option value="">{labels.form.noWorkflows}</option> : null}
                {workflowDefinitions.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.title || workflow.name}
                  </option>
                ))}
              </select>
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
          <select
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
            <option value="suggest_only">{labels.safety.suggest_only}</option>
            <option value="ask_before_apply">{labels.safety.ask_before_apply}</option>
            <option value="auto_apply">{labels.safety.auto_apply}</option>
          </select>
          <p className="mt-1 text-xs leading-5 text-fg-muted">
            {form.safetyMode === 'suggest_only'
              ? labels.safety.suggestOnlyDescription
              : form.safetyMode === 'ask_before_apply'
                ? labels.safety.askBeforeApplyDescription
                : labels.safety.autoApplyDescription}
          </p>
        </Field>

        <Section title={labels.form.afterRun} />
        <select className={inputClass} value={form.afterRunMode} onChange={(e) => update({ afterRunMode: e.target.value as FormState['afterRunMode'] })}>
          <option value="none">{labels.afterRun.none}</option>
          <option value="saveToSession">{labels.afterRun.saveToSession}</option>
          <option value="webhook" disabled={form.safetyMode !== 'auto_apply'}>{labels.afterRun.webhook}</option>
        </select>
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
