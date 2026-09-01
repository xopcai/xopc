import {
  NotificationTargetSchema,
  type AgentRunEndedEvent,
  type ProductNotification,
  type ProductNotificationType,
} from '@xopcai/gateway-contract';

import type { AutomationRun } from '../automations/domain/types.js';

export type NotificationPlan = {
  dedupeKey: string;
  notification: Omit<ProductNotification, 'schemaVersion' | 'id' | 'createdAt'>;
};

type TaskPayload = {
  sourceEventId?: unknown;
  task?: { id?: unknown; title?: unknown };
  taskId?: unknown;
  reason?: unknown;
  to?: unknown;
  resolution?: unknown;
};

function chatPlan(payload: unknown): NotificationPlan | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = payload as Partial<AgentRunEndedEvent>;
  if (event.status !== 'success' && event.status !== 'error') return null;
  if (typeof event.runId !== 'string' || !event.runId) return null;
  const target = NotificationTargetSchema.safeParse(event.target);
  if (!target.success || target.data.kind !== 'chat' || target.data.sessionKey !== event.sessionKey) return null;
  const completed = event.status === 'success';
  const type: ProductNotificationType = completed ? 'chat.completed' : 'chat.failed';
  const fallback = {
    en: 'Open the conversation to review the result.',
    zh: '打开对话查看结果。',
  };
  const sessionTitle = typeof event.sessionTitle === 'string' ? event.sessionTitle.trim().slice(0, 120) : '';
  return {
    dedupeKey: `${type}:${event.runId}`,
    notification: {
      type,
      target: target.data,
      priority: completed ? 'normal' : 'high',
      title: completed
        ? { en: 'Response ready', zh: '回答已就绪' }
        : { en: 'Response needs attention', zh: '回答需要处理' },
      body: sessionTitle ? { en: sessionTitle, zh: sessionTitle } : fallback,
      payload: { runId: event.runId },
    },
  };
}

function taskPlan(payload: unknown): NotificationPlan | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as TaskPayload;
  const taskId = typeof data.task?.id === 'string'
    ? data.task.id
    : typeof data.taskId === 'string' ? data.taskId : '';
  const sourceEventId = typeof data.sourceEventId === 'string' ? data.sourceEventId : '';
  if (!taskId || !sourceEventId) return null;
  const type: ProductNotificationType | undefined = data.reason === 'blocked'
    ? 'task.blocked'
    : data.reason === 'failed'
      ? 'task.failed'
    : data.reason === 'user_input' || data.reason === 'approval'
      ? 'task.needs_input'
      : data.to === 'closed' && data.resolution === 'done'
        ? 'task.completed'
        : undefined;
  if (!type) return null;
  const taskTitle = typeof data.task?.title === 'string' ? data.task.title.trim().slice(0, 120) : '';
  const title = type === 'task.needs_input'
    ? { en: 'Action needed', zh: '需要你的操作' }
    : type === 'task.blocked'
      ? { en: 'Task blocked', zh: '任务受阻' }
      : type === 'task.failed'
        ? { en: 'Task failed', zh: '任务失败' }
      : { en: 'Task completed', zh: '任务已完成' };
  return {
    dedupeKey: `${type}:${sourceEventId}`,
    notification: {
      type,
      target: { kind: 'task', taskId },
      priority: type === 'task.completed' ? 'normal' : 'high',
      title,
      ...(taskTitle ? { body: { en: taskTitle, zh: taskTitle } } : {}),
      payload: { taskId, sourceEventId },
    },
  };
}

function automationPlan(payload: unknown): NotificationPlan | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = payload as {
    run?: AutomationRun;
    notificationPolicy?: 'attention' | 'all' | 'none';
    requiresAttention?: boolean;
  };
  if (event.notificationPolicy === 'none') return null;
  if (event.notificationPolicy === 'attention' && event.requiresAttention !== true) return null;
  const run = event.run;
  if (!run || (run.status !== 'failed' && run.status !== 'timeout' && run.status !== 'succeeded')) return null;
  const completed = run.status === 'succeeded';
  const type: ProductNotificationType = completed ? 'automation.completed' : 'automation.failed';
  return {
    dedupeKey: `${type}:${run.id}`,
    notification: {
      type,
      target: { kind: 'automation_run', automationId: run.automationId, runId: run.id },
      priority: completed ? 'normal' : 'high',
      title: completed
        ? { en: 'Automation completed', zh: '自动化已完成' }
        : { en: 'Automation needs attention', zh: '自动化需要处理' },
      body: {
        en: (run.error || run.summary || run.automationName).slice(0, 180),
        zh: (run.error || run.summary || run.automationName).slice(0, 180),
      },
      payload: { automationId: run.automationId, runId: run.id },
    },
  };
}

function proactivePlan(payload: unknown): NotificationPlan | null {
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as {
    id?: unknown;
    insight?: { id?: unknown; title?: unknown; summary?: unknown; urgency?: unknown };
  };
  if (
    typeof item.id !== 'string'
    || typeof item.insight?.id !== 'string'
    || typeof item.insight.title !== 'string'
  ) return null;
  const title = item.insight.title.trim().slice(0, 120);
  const summary = typeof item.insight.summary === 'string' ? item.insight.summary.trim().slice(0, 180) : '';
  return {
    dedupeKey: `proactive.insight:${item.id}`,
    notification: {
      type: 'proactive.insight',
      target: { kind: 'insight', inboxItemId: item.id },
      priority: item.insight.urgency === 'high' || item.insight.urgency === 'critical' ? 'high' : 'normal',
      title: { en: title, zh: title },
      ...(summary ? { body: { en: summary, zh: summary } } : {}),
      payload: { inboxItemId: item.id, insightId: item.insight.id },
    },
  };
}

export function notificationPlanFromGatewayEvent(type: string, payload: unknown): NotificationPlan | null {
  if (type === 'agent.run.ended') return chatPlan(payload);
  if (type === 'task.attention_required.v2' || type === 'task.phase_changed.v2') return taskPlan(payload);
  if (type === 'automation.run.completed') return automationPlan(payload);
  if (type === 'proactive.inbox.created') return proactivePlan(payload);
  return null;
}
