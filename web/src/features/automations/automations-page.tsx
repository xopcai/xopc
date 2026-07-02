import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Activity, GitBranch, Pause, Play, Plus, RefreshCw, Trash2, X, Zap } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { messages, type MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { listWorkflowDefinitions, type WorkflowDefinition } from '@/features/workflows/workflow-api';
import {
  automationApi,
  type Automation,
  type AutomationAction,
  type AutomationInput,
  type AutomationRun,
  type AutomationTrigger,
} from './automation-api';

type Tab = 'automations' | 'runs' | 'templates';
type TriggerMode = 'manual' | 'daily' | 'weekly' | 'interval' | 'cron' | 'webhook';
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
  const schedule = trigger.schedule;
  if (schedule.kind === 'once') return labels.trigger.onceAt.replace('{time}', formatDate(Date.parse(schedule.at), labels));
  if (schedule.kind === 'interval') return labels.trigger.everyMinutes.replace('{minutes}', String(Math.round(schedule.everyMs / 60000)));
  return schedule.expr;
}

function actionLabel(action: AutomationAction, labels: AutomationsMessages): string {
  if (action.kind === 'workflow') return labels.action.workflowWithId.replace('{id}', action.workflowId);
  return action.agentId ? labels.action.agentWithId.replace('{id}', action.agentId) : labels.action.agent;
}

function statusClass(status?: AutomationRun['status']) {
  if (status === 'succeeded') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed' || status === 'timeout') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'running' || status === 'queued') return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
  return 'bg-surface-hover text-fg-muted';
}

function buildInput(form: FormState): AutomationInput {
  const [hourRaw, minuteRaw] = form.time.split(':');
  const hour = Number.parseInt(hourRaw || '9', 10);
  const minute = Number.parseInt(minuteRaw || '0', 10);
  let trigger: AutomationTrigger;
  if (form.triggerMode === 'manual') {
    trigger = { kind: 'manual' };
  } else if (form.triggerMode === 'webhook') {
    trigger = { kind: 'webhook', ...(form.webhookSecretId.trim() ? { secretId: form.webhookSecretId.trim() } : {}) };
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

  const action: AutomationAction =
    form.actionMode === 'workflow'
      ? {
          kind: 'workflow',
          workflowId: form.workflowId.trim(),
          ...(form.agentId.trim() ? { agentId: form.agentId.trim() } : {}),
          ...(form.workflowGoal.trim() ? { goal: form.workflowGoal.trim() } : {}),
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
    afterRun:
      form.afterRunMode === 'webhook'
        ? { kind: 'webhook', url: form.webhookUrl.trim() }
        : { kind: form.afterRunMode },
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
  const [tab, setTab] = useState<Tab>('automations');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState<string | null>(null);

  const automationsSwr = useSWR('automations', () => automationApi.list(), { refreshInterval: 15_000 });
  const runsSwr = useSWR('automation-runs', () => automationApi.runs(50), { refreshInterval: 10_000 });
  const metricsSwr = useSWR('automation-metrics', () => automationApi.metrics(), { refreshInterval: 15_000 });
  const workflowDefinitionsSwr = useSWR('automation-workflow-definitions', listWorkflowDefinitions);
  const chatAgentsSwr = useSWR('automation-chat-agents', fetchChatAgents);

  const automations = automationsSwr.data?.automations ?? [];
  const runs = runsSwr.data?.runs ?? [];
  const metrics = metricsSwr.data;
  const workflowDefinitions = useMemo(() => workflowDefinitionsSwr.data ?? [], [workflowDefinitionsSwr.data]);
  const agentOptions = chatAgentsSwr.data?.items ?? [];
  const workflowSelectionInvalid =
    form.actionMode === 'workflow' &&
    (!form.workflowId.trim() ||
      (workflowDefinitions.length > 0 && !workflowDefinitions.some((workflow) => workflow.id === form.workflowId)));
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
    ],
    [labels, workflowDefinitions],
  );

  const reload = useCallback(async () => {
    await Promise.all([automationsSwr.mutate(), runsSwr.mutate(), metricsSwr.mutate()]);
  }, [automationsSwr.mutate, metricsSwr.mutate, runsSwr.mutate]);

  async function submitForm() {
    setError(null);
    try {
      await automationApi.create(buildInput(form));
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
          <RunsList runs={runs} labels={labels} onAction={mutateAutomation} />
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
              workflowsLoading={workflowDefinitionsSwr.isLoading}
              agentOptions={agentOptions}
              agentsLoading={chatAgentsSwr.isLoading}
            />
            <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
              <Dialog.Close asChild>
                <Button variant="ghost">{labels.cancel}</Button>
              </Dialog.Close>
              <Button variant="primary" onClick={submitForm} disabled={workflowSelectionInvalid}>
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
      {automations.map((automation) => (
        <div key={automation.id} className="grid gap-3 border-b border-edge p-4 last:border-b-0 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-fg">{automation.name}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs', automation.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-surface-hover text-fg-muted')}>
                {automation.enabled ? labels.enabled : labels.paused}
              </span>
            </div>
            {automation.description ? <div className="mt-1 truncate text-sm text-fg-muted">{automation.description}</div> : null}
          </div>
          <Info label={labels.info.when} value={triggerLabel(automation.trigger, labels)} />
          <Info label={labels.info.run} value={actionLabel(automation.action, labels)} />
          <div className="flex flex-wrap items-center justify-end gap-2">
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
      ))}
    </div>
  );
}

function RunsList({
  runs,
  labels,
  onAction,
}: {
  runs: AutomationRun[];
  labels: AutomationsMessages;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
}) {
  if (runs.length === 0) return <EmptyState icon={<Activity className="size-5" />} title={labels.empty.runs} />;
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-panel">
      {runs.map((run) => (
        <div key={run.id} className="grid gap-3 border-b border-edge p-4 last:border-b-0 md:grid-cols-[1fr_auto]">
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
            <Button variant="ghost" onClick={() => onAction(() => automationApi.cancelRun(run.id))}>{labels.cancel}</Button>
          ) : null}
        </div>
      ))}
    </div>
  );
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
  workflowsLoading,
  agentOptions,
  agentsLoading,
}: {
  form: FormState;
  labels: AutomationsMessages;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  workflowDefinitions: WorkflowDefinition[];
  workflowsLoading: boolean;
  agentOptions: ChatAgentOption[];
  agentsLoading: boolean;
}) {
  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (form.actionMode !== 'workflow') return;
    if (form.workflowId.trim()) return;
    const firstWorkflowId = workflowDefinitions[0]?.id;
    if (!firstWorkflowId) return;
    setForm((prev) => ({ ...prev, workflowId: firstWorkflowId }));
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
                ? { workflowId: workflowDefinitions[0].id }
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
            <textarea className={cn(inputClass, 'min-h-32 resize-y')} value={form.instruction} onChange={(e) => update({ instruction: e.target.value })} />
          </Field>
        ) : (
          <>
            <Field label={labels.form.workflow}>
              <select
                className={inputClass}
                value={form.workflowId}
                onChange={(e) => update({ workflowId: e.target.value })}
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
            <Field label={labels.form.goal}>
              <textarea className={cn(inputClass, 'min-h-24 resize-y')} value={form.workflowGoal} onChange={(e) => update({ workflowGoal: e.target.value })} />
            </Field>
          </>
        )}

        <Section title={labels.form.afterRun} />
        <select className={inputClass} value={form.afterRunMode} onChange={(e) => update({ afterRunMode: e.target.value as FormState['afterRunMode'] })}>
          <option value="none">{labels.afterRun.none}</option>
          <option value="saveToSession">{labels.afterRun.saveToSession}</option>
          <option value="webhook">{labels.afterRun.webhook}</option>
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
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
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
