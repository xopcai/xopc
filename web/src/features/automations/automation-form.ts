import type { WorkflowDefinition } from '@/features/workflows/workflow-api';
import {
  resolveWorkflowInputPayload,
} from '@/features/workflows/workflow-input-editor.utils';
import { workflowInputToArgValues } from '@/features/workflows/workflow-input.utils';
import type { WorkflowRunSetupValue } from '@/features/workflows/workflow-run-setup-panel';

import {
  type Automation,
  type AutomationAction,
  type AutomationConversationMode,
  type AutomationInput,
  type AutomationNotificationPolicy,
  type AutomationSafetyMode,
  type AutomationTrigger,
} from './automation-api';
import {
  automationIntervalMs,
  type AutomationIntervalUnit,
} from './automation-display';

export type TriggerMode =
  | 'manual'
  | 'once'
  | 'daily'
  | 'weekly'
  | 'interval'
  | 'cron'
  | 'webhook'
  | 'taskBlocked'
  | 'noteCreated'
  | 'workflowFailed'
  | 'sessionUpdated'
  | 'event';

export type ActionMode = 'agent' | 'workflow' | 'browser_recipe';

export interface FormState {
  name: string;
  description: string;
  projectId: string;
  triggerMode: TriggerMode;
  time: string;
  weekday: string;
  intervalValue: string;
  intervalUnit: AutomationIntervalUnit;
  cronExpr: string;
  webhookSecretId: string;
  onceAt: string;
  eventType: string;
  eventSource: string;
  eventPayloadMatch: string;
  actionMode: ActionMode;
  agentId: string;
  instruction: string;
  workflowId: string;
  workflowGoal: string;
  workflowInput: WorkflowRunSetupValue;
  workflowInputValid: boolean;
  browserWorkflowId: string;
  browserWorkflowInputs: Record<string, unknown>;
  safetyMode: AutomationSafetyMode;
  timeoutSeconds: string;
  conversationMode: AutomationConversationMode;
  notificationPolicy: AutomationNotificationPolicy;
  completionWebhookUrl: string;
  disableAfterFailures: string;
}

export const initialForm: FormState = {
  name: '',
  description: '',
  projectId: '',
  triggerMode: 'daily',
  time: '09:00',
  weekday: '1',
  intervalValue: '1',
  intervalUnit: 'hour',
  cronExpr: '0 9 * * *',
  webhookSecretId: '',
  onceAt: '',
  eventType: '',
  eventSource: '',
  eventPayloadMatch: '',
  actionMode: 'agent',
  agentId: '',
  instruction: '',
  workflowId: '',
  workflowGoal: '',
  workflowInput: {
    goal: '',
    argValues: {},
    schemaInput: {},
    concurrency: '',
    maxSubagents: '',
  },
  workflowInputValid: true,
  browserWorkflowId: '',
  browserWorkflowInputs: {},
  safetyMode: 'suggest_only',
  timeoutSeconds: '1800',
  conversationMode: 'new_session',
  notificationPolicy: 'attention',
  completionWebhookUrl: '',
  disableAfterFailures: '3',
};

export const INTERVAL_PRESETS: Array<{
  value: string;
  unit: AutomationIntervalUnit;
}> = [
  { value: '15', unit: 'minute' },
  { value: '30', unit: 'minute' },
  { value: '1', unit: 'hour' },
  { value: '6', unit: 'hour' },
  { value: '24', unit: 'hour' },
];

export function buildInput(
  form: FormState,
  selectedWorkflow: WorkflowDefinition | null,
): AutomationInput {
  const [hourRaw, minuteRaw] = form.time.split(':');
  const hour = Number.parseInt(hourRaw || '9', 10);
  const minute = Number.parseInt(minuteRaw || '0', 10);
  let trigger: AutomationTrigger;
  if (form.triggerMode === 'manual') {
    trigger = { kind: 'manual' };
  } else if (form.triggerMode === 'once') {
    trigger = {
      kind: 'schedule',
      schedule: { kind: 'once', at: new Date(form.onceAt).toISOString() },
    };
  } else if (form.triggerMode === 'webhook') {
    trigger = {
      kind: 'webhook',
      ...(form.webhookSecretId.trim()
        ? { secretId: form.webhookSecretId.trim() }
        : {}),
    };
  } else if (form.triggerMode === 'taskBlocked') {
    trigger = {
      kind: 'event',
      eventType: 'task.attention_required.v2',
      source: 'tasks',
      payloadMatch: { reason: 'blocked' },
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
    trigger = {
      kind: 'event',
      eventType: 'session.transcript.updated',
      source: 'sessions',
    };
  } else if (form.triggerMode === 'event') {
    const payloadMatch = form.eventPayloadMatch.trim()
      ? (JSON.parse(form.eventPayloadMatch) as Record<
          string,
          string | number | boolean | null
        >)
      : undefined;
    trigger = {
      kind: 'event',
      eventType: form.eventType.trim(),
      ...(form.eventSource.trim() ? { source: form.eventSource.trim() } : {}),
      ...(payloadMatch ? { payloadMatch } : {}),
    };
  } else if (form.triggerMode === 'interval') {
    trigger = {
      kind: 'schedule',
      schedule: {
        kind: 'interval',
        everyMs: automationIntervalMs(form.intervalValue, form.intervalUnit),
      },
    };
  } else if (form.triggerMode === 'weekly') {
    trigger = {
      kind: 'schedule',
      schedule: {
        kind: 'cron',
        expr: `${minute} ${hour} * * ${form.weekday}`,
      },
    };
  } else if (form.triggerMode === 'cron') {
    trigger = {
      kind: 'schedule',
      schedule: { kind: 'cron', expr: form.cronExpr.trim() },
    };
  } else {
    trigger = {
      kind: 'schedule',
      schedule: { kind: 'cron', expr: `${minute} ${hour} * * *` },
    };
  }

  const workflowInput = resolveWorkflowInputPayload(
    selectedWorkflow,
    form.workflowInput,
  );
  const workflowGoal = form.workflowInput.goal.trim() || form.workflowGoal.trim();
  const safetyMode = form.actionMode === 'browser_recipe' ? 'auto_apply' : form.safetyMode;
  let action: AutomationAction;
  if (form.actionMode === 'workflow') {
    action = {
      kind: 'workflow',
          workflowId: form.workflowId.trim(),
          ...(form.agentId.trim() ? { agentId: form.agentId.trim() } : {}),
          ...(workflowInput !== undefined ? { input: workflowInput } : {}),
          ...(workflowGoal ? { goal: workflowGoal } : {}),
          ...(form.workflowInput.concurrency.trim()
            ? {
                concurrency: Math.max(
                  1,
                  Number.parseInt(form.workflowInput.concurrency, 10) || 1,
                ),
              }
            : {}),
          ...(form.workflowInput.maxSubagents.trim()
            ? {
                maxSubagents: Math.max(
                  1,
                  Number.parseInt(form.workflowInput.maxSubagents, 10) || 1,
                ),
              }
            : {}),
    };
  } else if (form.actionMode === 'browser_recipe') {
    action = {
      kind: 'browser_recipe',
      recipeId: form.browserWorkflowId.trim(),
      args: form.browserWorkflowInputs,
    };
  } else {
    action = {
      kind: 'agent',
      instruction: form.instruction.trim(),
      ...(form.agentId.trim() ? { agentId: form.agentId.trim() } : {}),
    };
  }

  return {
    name: form.name.trim(),
    ...(form.description.trim()
      ? { description: form.description.trim() }
      : {}),
    ...(form.projectId.trim() ? { projectId: form.projectId.trim() } : {}),
    trigger,
    action,
    safety: { mode: safetyMode },
    conversationMode: form.conversationMode,
    notificationPolicy: form.notificationPolicy,
    ...(safetyMode === 'auto_apply' && form.completionWebhookUrl.trim()
      ? { completionWebhookUrl: form.completionWebhookUrl.trim() }
      : {}),
    reliability: {
      executionTimeoutSeconds: Math.max(
        1,
        Number.parseInt(form.timeoutSeconds, 10) || 1800,
      ),
      disableAfterConsecutiveFailures: Math.max(
        1,
        Number.parseInt(form.disableAfterFailures, 10) || 3,
      ),
    },
  };
}

function cronFormState(
  expr: string,
): Pick<FormState, 'triggerMode' | 'time' | 'weekday' | 'cronExpr'> {
  const daily = expr.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (daily) {
    return {
      triggerMode: 'daily',
      time: `${daily[2].padStart(2, '0')}:${daily[1].padStart(2, '0')}`,
      weekday: '1',
      cronExpr: expr,
    };
  }
  const weekly = expr.match(
    /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/,
  );
  if (weekly) {
    return {
      triggerMode: 'weekly',
      time: `${weekly[2].padStart(2, '0')}:${weekly[1].padStart(2, '0')}`,
      weekday: weekly[3],
      cronExpr: expr,
    };
  }
  return {
    triggerMode: 'cron',
    time: initialForm.time,
    weekday: initialForm.weekday,
    cronExpr: expr,
  };
}

function intervalFormState(
  everyMs: number,
): Pick<FormState, 'intervalValue' | 'intervalUnit'> {
  const units: Array<[AutomationIntervalUnit, number]> = [
    ['week', 7 * 24 * 60 * 60_000],
    ['day', 24 * 60 * 60_000],
    ['hour', 60 * 60_000],
    ['minute', 60_000],
  ];
  const [unit, unitMs] =
    units.find(([, ms]) => everyMs >= ms && everyMs % ms === 0) ??
    units.at(-1)!;
  return {
    intervalValue: String(everyMs / unitMs),
    intervalUnit: unit,
  };
}

function localDateTimeValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function eventFormState(
  trigger: Extract<AutomationTrigger, { kind: 'event' }>,
): Partial<FormState> {
  const payload = trigger.payloadMatch;
  if (
    trigger.eventType === 'task.attention_required.v2' &&
    trigger.source === 'tasks' &&
    payload?.reason === 'blocked'
  ) {
    return { triggerMode: 'taskBlocked' };
  }
  if (
    trigger.eventType === 'note.created' &&
    trigger.source === 'notes' &&
    !payload
  ) {
    return { triggerMode: 'noteCreated' };
  }
  if (
    trigger.eventType === 'workflow.run.completed' &&
    trigger.source === 'workflows' &&
    payload?.status === 'failed'
  ) {
    return { triggerMode: 'workflowFailed' };
  }
  if (
    trigger.eventType === 'session.transcript.updated' &&
    trigger.source === 'sessions' &&
    !payload
  ) {
    return { triggerMode: 'sessionUpdated' };
  }
  return {
    triggerMode: 'event',
    eventType: trigger.eventType,
    eventSource: trigger.source ?? '',
    eventPayloadMatch: payload ? JSON.stringify(payload, null, 2) : '',
  };
}

function workflowInputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function payloadMatchIsValid(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const parsed = JSON.parse(value);
    return (
      Boolean(parsed) &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.values(parsed as Record<string, unknown>).every(
        (item) =>
          item === null ||
          ['string', 'number', 'boolean'].includes(typeof item),
      )
    );
  } catch {
    return false;
  }
}

export function formFromAutomation(
  automation: AutomationInput,
  workflowDefinitions: WorkflowDefinition[] = [],
): FormState {
  let triggerState: Partial<FormState> = { triggerMode: 'manual' };
  if (automation.trigger.kind === 'webhook') {
    triggerState = {
      triggerMode: 'webhook',
      webhookSecretId: automation.trigger.secretId ?? '',
    };
  } else if (automation.trigger.kind === 'event') {
    triggerState = eventFormState(automation.trigger);
  } else if (automation.trigger.kind === 'schedule') {
    const schedule = automation.trigger.schedule;
    if (schedule.kind === 'cron') {
      triggerState = cronFormState(schedule.expr);
    }
    if (schedule.kind === 'interval') {
      triggerState = {
        triggerMode: 'interval',
        ...intervalFormState(schedule.everyMs),
      };
    }
    if (schedule.kind === 'once') {
      triggerState = {
        triggerMode: 'once',
        onceAt: localDateTimeValue(schedule.at),
      };
    }
  }

  const action = automation.action;
  const definition =
    action.kind === 'workflow'
      ? (workflowDefinitions.find((item) => item.id === action.workflowId) ??
        null)
      : null;
  const workflowInput =
    action.kind === 'workflow' ? workflowInputRecord(action.input) : {};
  const timeoutSeconds =
    automation.reliability?.executionTimeoutSeconds
    ?? action.timeoutSeconds
    ?? automation.reliability?.timeoutSeconds
    ?? (action.kind === 'browser_recipe' ? 600 : 1800);

  return {
    ...initialForm,
    ...triggerState,
    name: automation.name,
    description: automation.description ?? '',
    projectId: automation.projectId ?? '',
    actionMode: action.kind,
    agentId: action.kind === 'browser_recipe' ? '' : (action.agentId ?? ''),
    instruction: action.kind === 'agent' ? action.instruction : '',
    workflowId: action.kind === 'workflow' ? action.workflowId : '',
    workflowGoal: action.kind === 'workflow' ? (action.goal ?? '') : '',
    browserWorkflowId: action.kind === 'browser_recipe' ? action.recipeId : '',
    browserWorkflowInputs: action.kind === 'browser_recipe' ? action.args ?? {} : {},
    workflowInput: {
      goal: action.kind === 'workflow' ? (action.goal ?? '') : '',
      argValues: definition
        ? workflowInputToArgValues(definition.name, workflowInput)
        : {},
      schemaInput: workflowInput,
      concurrency:
        action.kind === 'workflow' && action.concurrency
          ? String(action.concurrency)
          : '',
      maxSubagents:
        action.kind === 'workflow' && action.maxSubagents
          ? String(action.maxSubagents)
          : '',
    },
    workflowInputValid: true,
    safetyMode: automation.safety?.mode ?? 'auto_apply',
    timeoutSeconds: String(timeoutSeconds),
    conversationMode: automation.conversationMode ?? 'new_session',
    notificationPolicy: automation.notificationPolicy ?? 'attention',
    completionWebhookUrl: automation.completionWebhookUrl ?? '',
    disableAfterFailures: String(
      automation.reliability?.disableAfterConsecutiveFailures ?? 3,
    ),
  };
}

export function buildAutomationEditInput(
  automation: Automation,
  form: FormState,
  selectedWorkflow: WorkflowDefinition | null,
): AutomationInput {
  const input = buildInput(form, selectedWorkflow);
  const trigger =
    automation.trigger.kind === 'schedule' &&
    input.trigger.kind === 'schedule' &&
    automation.trigger.schedule.kind === input.trigger.schedule.kind
      ? {
          ...input.trigger,
          schedule: {
            ...automation.trigger.schedule,
            ...input.trigger.schedule,
          },
        }
      : input.trigger;
  let action: AutomationAction = input.action;
  if (
    automation.action.kind === 'agent' &&
    input.action.kind === 'agent'
  ) {
    action = {
      ...automation.action,
      ...input.action,
      agentId: input.action.agentId,
    };
  } else if (
    automation.action.kind === 'workflow' &&
    input.action.kind === 'workflow'
  ) {
    action = {
      ...automation.action,
      ...input.action,
      agentId: input.action.agentId,
      input: input.action.input,
      goal: input.action.goal,
      concurrency: input.action.concurrency,
      maxSubagents: input.action.maxSubagents,
    };
  } else if (
    automation.action.kind === 'browser_recipe' &&
    input.action.kind === 'browser_recipe'
  ) {
    action = { ...automation.action, ...input.action };
  }
  return {
    ...input,
    description: form.description.trim(),
    projectId: form.projectId.trim(),
    completionWebhookUrl: form.completionWebhookUrl.trim(),
    trigger,
    action,
    reliability: {
      ...automation.reliability,
      ...input.reliability,
    },
  };
}
