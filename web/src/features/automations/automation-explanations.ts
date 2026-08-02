import type { MessageBundle } from '@/i18n/messages';

import type {
  Automation,
  AutomationAction,
  AutomationRun,
  AutomationRunEvent,
  AutomationSafetyPolicy,
} from './automation-api';

type AutomationsMessages = MessageBundle['automations'];

export type AutomationCoverageEvent = {
  eventType: string;
  source?: string;
  eventPayload?: Record<string, string | number | boolean | null>;
};

export function formatAutomationMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

export function matchesCoverage(automation: Automation, coverage: AutomationCoverageEvent): boolean {
  if (!automation.enabled || automation.trigger.kind !== 'event') return false;
  if (automation.trigger.eventType !== coverage.eventType) return false;
  if (automation.trigger.source && automation.trigger.source !== coverage.source) return false;
  const payloadMatch = automation.trigger.payloadMatch;
  if (!payloadMatch) return true;
  const eventPayload = coverage.eventPayload ?? {};
  return Object.entries(payloadMatch).every(([key, value]) => Object.is(eventPayload[key], value));
}

export function buildCoverageExplanation(
  automation: Automation,
  labels: AutomationsMessages,
): string[] {
  const trigger = automation.trigger;
  const explain = labels.explain;
  if (trigger.kind !== 'event') return [explain.triggerMatched, actionExplanation(automation.action, labels)];

  return [
    eventExplanation(trigger.eventType, trigger.source, labels),
    payloadExplanation(trigger.payloadMatch, labels),
    safetyExplanation(automation.safety, labels),
    actionExplanation(automation.action, labels),
  ];
}

export function buildRunExplanation(
  run: AutomationRun,
  triggerEvent: AutomationRunEvent,
  labels: AutomationsMessages,
): string[] {
  const trigger = run.triggerSnapshot;
  const event = readTriggerEvent(triggerEvent);
  const explain = labels.explain;

  if (trigger.kind === 'event') {
    const eventLine = event
      ? eventExplanation(event.type, event.source, labels)
      : eventExplanation(trigger.eventType, trigger.source, labels);
    return [
      eventLine,
      payloadExplanation(trigger.payloadMatch, labels),
      safetyExplanation(readSafetyPolicy(triggerEvent), labels),
      actionExplanation(run.actionSnapshot, labels),
    ];
  }

  if (trigger.kind === 'manual') return [explain.manual, actionExplanation(run.actionSnapshot, labels)];
  if (trigger.kind === 'webhook') return [explain.webhook, actionExplanation(run.actionSnapshot, labels)];
  return [explain.schedule, actionExplanation(run.actionSnapshot, labels)];
}

function eventExplanation(eventType: string, source: string | undefined, labels: AutomationsMessages): string {
  const explain = labels.explain;
  return source
    ? formatAutomationMessage(explain.eventFrom, { eventType, source })
    : formatAutomationMessage(explain.event, { eventType });
}

function payloadExplanation(
  payloadMatch: Record<string, string | number | boolean | null> | undefined,
  labels: AutomationsMessages,
): string {
  if (!payloadMatch || Object.keys(payloadMatch).length === 0) return labels.explain.noPayloadFilter;
  const pairs = Object.entries(payloadMatch)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
  return formatAutomationMessage(labels.explain.payloadMatched, { pairs });
}

function actionExplanation(action: AutomationAction, labels: AutomationsMessages): string {
  if (action.kind === 'workflow') {
    return formatAutomationMessage(labels.explain.actionWorkflow, { workflowId: action.workflowId });
  }
  if (action.kind === 'browser_recipe') return `Runs browser automation ${action.recipeId}.`;
  return labels.explain.actionAgent;
}

function safetyExplanation(safety: AutomationSafetyPolicy | undefined, labels: AutomationsMessages): string {
  const mode = safety?.mode ?? 'auto_apply';
  return formatAutomationMessage(labels.explain.safetyMode, { mode: labels.safety[mode] });
}

function readSafetyPolicy(triggerEvent: AutomationRunEvent): AutomationSafetyPolicy | undefined {
  if (!triggerEvent.data || typeof triggerEvent.data !== 'object' || Array.isArray(triggerEvent.data)) return undefined;
  const safety = (triggerEvent.data as { safety?: unknown }).safety;
  if (!safety || typeof safety !== 'object' || Array.isArray(safety)) return undefined;
  const mode = (safety as { mode?: unknown }).mode;
  return mode === 'suggest_only' || mode === 'ask_before_apply' || mode === 'auto_apply' ? { mode } : undefined;
}

function readTriggerEvent(triggerEvent: AutomationRunEvent): { type: string; source?: string } | null {
  if (!triggerEvent.data || typeof triggerEvent.data !== 'object' || Array.isArray(triggerEvent.data)) return null;
  const event = (triggerEvent.data as { event?: unknown }).event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const candidate = event as { type?: unknown; source?: unknown };
  if (typeof candidate.type !== 'string' || !candidate.type.trim()) return null;
  return {
    type: candidate.type,
    source: typeof candidate.source === 'string' ? candidate.source : undefined,
  };
}
