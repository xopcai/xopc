import type { AgentRunNotification } from './agent-run-notification';

type AutomationRunCompletedEvent = {
  run: {
    id: string;
    automationId: string;
    automationName: string;
    status: 'succeeded' | 'failed' | 'timeout' | 'cancelled';
    summary?: string;
    error?: string;
  };
  notificationPolicy: 'attention' | 'all' | 'none';
  requiresAttention: boolean;
};

export function parseAutomationRunCompletedEvent(value: unknown): AutomationRunCompletedEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<AutomationRunCompletedEvent>;
  const run = event.run;
  if (
    !run
    || typeof run.id !== 'string'
    || typeof run.automationId !== 'string'
    || typeof run.automationName !== 'string'
    || !['succeeded', 'failed', 'timeout', 'cancelled'].includes(run.status)
    || !['attention', 'all', 'none'].includes(event.notificationPolicy ?? '')
    || typeof event.requiresAttention !== 'boolean'
  ) return null;
  return event as AutomationRunCompletedEvent;
}

export function buildAutomationRunNotification(
  event: AutomationRunCompletedEvent,
  language: 'en' | 'zh',
): AgentRunNotification | null {
  if (event.notificationPolicy === 'none') return null;
  if (event.notificationPolicy === 'attention' && !event.requiresAttention) return null;
  const failed = event.run.status !== 'succeeded';
  const route = `/automations?automation=${encodeURIComponent(event.run.automationId)}&run=${encodeURIComponent(event.run.id)}`;
  return {
    id: `automation-run:${event.run.id}`,
    title: failed
      ? language === 'zh' ? '自动化需要处理' : 'Automation needs attention'
      : language === 'zh' ? '自动化已完成' : 'Automation completed',
    body: event.run.error || event.run.summary || event.run.automationName,
    route,
    status: failed ? 'error' : 'success',
  };
}
