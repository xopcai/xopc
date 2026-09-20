import type { NotificationPlan } from '../../notifications/planner.js';

export function proactivePlan(payload: unknown): NotificationPlan | null {
  if (!payload || typeof payload !== 'object') return null;
  const item = payload as {
    id?: unknown;
    insightId?: unknown;
    notificationRevision?: number;
    insight?: { title?: unknown; summary?: unknown; urgency?: unknown; attentionKind?: unknown };
  };
  if (
    typeof item.id !== 'string'
    || typeof item.insightId !== 'string'
    || typeof item.insight?.title !== 'string'
  ) return null;
  const requiresDecision = item.insight.attentionKind === 'decision';
  const highUrgency = item.insight.urgency === 'high' || item.insight.urgency === 'critical';
  if (item.insight.attentionKind === 'receipt') return null;
  if (!requiresDecision && !highUrgency) return null;
  const title = item.insight.title.trim().slice(0, 120);
  const summary = typeof item.insight.summary === 'string' ? item.insight.summary.trim().slice(0, 180) : '';
  return {
    dedupeKey: `proactive.insight:${item.id}${item.notificationRevision && item.notificationRevision > 1 ? `:${item.notificationRevision}` : ''}`,
    notification: {
      type: 'proactive.insight',
      target: { kind: 'insight', inboxItemId: item.id },
      priority: requiresDecision || highUrgency ? 'high' : 'normal',
      title: { en: title, zh: title },
      ...(summary ? { body: { en: summary, zh: summary } } : {}),
      payload: { inboxItemId: item.id, insightId: item.insightId, notificationRevision: item.notificationRevision ?? 1 },
    },
  };
}
