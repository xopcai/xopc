import { ProactiveCardActionSchema, type ProactiveCard, type ProactiveCardAction } from '@xopcai/gateway-contract';

import { executePendingProactiveActions } from '../actions/service.js';
import { withdrawCard } from './lifecycle.js';
import { getKnowledgeSourceItem } from '../../storage/sqlite/knowledge-repository.js';
import { insightSourcesAuthorized } from '../execution/authorization.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { effectiveProactivePolicy, ProactiveConflict, subscriptionSettings } from '../policy/service.js';
import { updateControlledSubscription } from '../scenarios/control.js';
import { ProactiveInboxService } from './service.js';
import { getInboxItem } from './repository.js';

export function requireCardScope(id: string, workspaceId: string): void {
  if (!getSqliteDatabase().prepare(`SELECT 1 FROM proactive_inbox_items i JOIN proactive_insights x USING(insight_id)
    JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE i.inbox_item_id = ? AND s.workspace_id = ?`).get(id, workspaceId)) throw new Error('Card not found');
}

export function getCard(id: string, workspaceId: string): ProactiveCard {
  requireCardScope(id, workspaceId);
  const item = getInboxItem(id)!;
  if (!insightSourcesAuthorized(item.insightId)) { withdrawCard(id); item.withdrawnAt = new Date().toISOString(); }
  if (item.withdrawnAt) return { schemaVersion: 1, id, revision: getInboxItem(id)!.revision!, notificationRevision: item.notificationRevision!, subscriptionId: item.subscriptionId!, scenarioKey: item.insight.scenarioKey, kind: 'briefing', status: 'withdrawn', title: 'Source unavailable / 来源已撤回', summary: '', whyNow: '', recommendation: '', workDone: '', evidence: [], createdAt: item.createdAt, updatedAt: item.withdrawnAt, fallbackText: 'Source unavailable / 来源已撤回' };
  const insight = item.insight;
  const expired = item.expiresAt && Date.parse(item.expiresAt) <= Date.now();
  return {
    schemaVersion: 1, id, revision: item.revision!, notificationRevision: item.notificationRevision!, subscriptionId: item.subscriptionId!,
    preparationAvailable: Boolean(subscriptionSettings(item.subscriptionId!).preparationWorkflowId),
    relatedCardIds: item.correlationKey ? (getSqliteDatabase().prepare('SELECT inbox_item_id AS id FROM proactive_inbox_items WHERE correlation_key = ? AND inbox_item_id <> ? AND withdrawn_at IS NULL').all(item.correlationKey, id) as Array<{ id: string }>).map((row) => row.id) : [],
    scenarioKey: insight.scenarioKey,
    kind: insight.attentionKind === 'receipt' ? 'receipt' : insight.decision ? 'decision'
      : insight.scenarioKey === 'meeting_preparation' ? 'briefing'
        : insight.scenarioKey.includes('risk') || insight.scenarioKey.includes('failure') ? 'risk'
          : insight.scenarioKey === 'blocked_work' ? 'reminder' : 'recommendation',
    status: expired ? 'expired' : item.status,
    title: insight.title, summary: insight.summary, whyNow: insight.whyNow, recommendation: insight.recommendation, workDone: insight.workDone,
    evidence: insight.evidenceIds.map((evidenceId) => cardEvidence(evidenceId, workspaceId)),
    ...(insight.decision ? { decision: insight.decision } : {}),
    actionStatus: insight.actionStatus, actionResult: insight.actionResult, actionError: insight.actionError,
    createdAt: item.createdAt, updatedAt: item.updatedAt, expiresAt: item.expiresAt,
    fallbackText: `${insight.title}\n${insight.summary}\n${insight.whyNow}`,
  };
}

export function listCards(workspaceId: string, input: { status?: string; before?: string; limit?: number } = {}) {
  const limit = Math.min(100, Math.max(1, input.limit ?? 30));
  const rows = getSqliteDatabase().prepare(`SELECT i.inbox_item_id, i.created_at FROM proactive_inbox_items i
    JOIN proactive_insights x USING(insight_id) JOIN proactive_scenario_subscriptions s USING(subscription_id)
    WHERE i.withdrawn_at IS NULL AND s.workspace_id = ? AND (? IS NULL OR i.status = ?) AND (? IS NULL OR i.created_at || ':' || i.inbox_item_id < ?)
    ORDER BY i.created_at DESC, i.inbox_item_id DESC LIMIT ?`)
    .all(workspaceId, input.status || null, input.status || null, input.before || null, input.before || null, limit + 1) as Array<{ inbox_item_id: string; created_at: string }>;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { cards: page.flatMap((row) => { try { const card = getCard(row.inbox_item_id, workspaceId); return card.status === 'withdrawn' ? [] : [card]; } catch { return []; } }), nextCursor: rows.length > limit && last ? `${last.created_at}:${last.inbox_item_id}` : null };
}

export function cardChanges(workspaceId: string, cursor = 0) {
  const db = getSqliteDatabase();
  const rows = db.prepare('SELECT sequence, inbox_item_id, deleted FROM proactive_card_changes WHERE sequence > ? AND workspace_id = ? ORDER BY sequence LIMIT 200').all(cursor, workspaceId) as Array<{ sequence: number; inbox_item_id: string; deleted: number }>;
  const items: Array<{ id: string; deleted: boolean; card?: ProactiveCard }> = [];
  for (const row of rows) {
    if (row.deleted) { items.push({ id: row.inbox_item_id, deleted: true }); continue; }
    try { const card = getCard(row.inbox_item_id, workspaceId); items.push(card.status === 'withdrawn' ? { id: row.inbox_item_id, deleted: true } : { id: row.inbox_item_id, deleted: false, card }); } catch { items.push({ id: row.inbox_item_id, deleted: true }); }
  }
  return { items, nextCursor: rows.at(-1)?.sequence ?? cursor, hasMore: rows.length === 200 };
}

export function performCardAction(id: string, workspaceId: string, value: unknown): ProactiveCard {
  const input = ProactiveCardActionSchema.parse(value);
  return runSqliteWriteTransaction((db) => {
    requireCardScope(id, workspaceId);
    const request = JSON.stringify({ id, ...input });
    const prior = db.prepare('SELECT request_json, response_json FROM proactive_card_actions WHERE idempotency_key = ?').get(input.idempotencyKey) as { request_json: string; response_json: string } | undefined;
    if (prior) {
      if (prior.request_json !== request) throw new ProactiveConflict('Idempotency key was already used for a different action');
      return getCard(id, workspaceId);
    }
    const card = getCard(id, workspaceId);
    if (card.revision !== input.expectedRevision) throw new ProactiveConflict('Card changed; refresh before acting');
    if (card.status === 'withdrawn' || card.status === 'expired' || (card.status === 'resolved' && !['useful', 'not_useful', 'retry'].includes(input.actionId))) throw new ProactiveConflict('Card is no longer actionable');
    applyCardAction(card, workspaceId, input);
    const result = getCard(id, workspaceId);
    db.prepare('INSERT INTO proactive_card_actions(idempotency_key, inbox_item_id, request_json, response_json) VALUES (?, ?, ?, ?)').run(input.idempotencyKey, id, request, JSON.stringify(result));
    return result;
  });
}

function applyCardAction(card: ProactiveCard, workspaceId: string, input: ProactiveCardAction) {
  const service = new ProactiveInboxService();
  switch (input.actionId) {
    case 'retry': {
      if (!effectiveProactivePolicy(card.subscriptionId).enabled) throw new Error('Subscription paused');
      const result = getSqliteDatabase().prepare("UPDATE proactive_insights SET action_status = 'pending', action_error = NULL, action_updated_at = ? WHERE insight_id = (SELECT insight_id FROM proactive_inbox_items WHERE inbox_item_id = ?) AND action_status = 'failed'").run(new Date().toISOString(), card.id);
      if (!result.changes) throw new Error('Only failed actions can be retried');
      executePendingProactiveActions();
      break;
    }
    case 'useful':
    case 'not_useful': service.feedback(card.id, input.actionId); break;
    case 'read': service.transition(card.id, { status: 'read' }); break;
    case 'resolve': service.transition(card.id, { status: 'resolved', resolution: 'dismissed' }); break;
    case 'snooze': service.transition(card.id, { status: 'snoozed', snoozedUntil: input.snoozedUntil ?? new Date(Date.now() + 3600000).toISOString() }); break;
    case 'decide':
      if (!input.choice) throw new Error('Decision choice required');
      if (!effectiveProactivePolicy(card.subscriptionId).enabled) throw new Error('Subscription paused');
      service.decide(card.id, input.choice);
      break;
    case 'less':
    case 'pause': {
      const settings = subscriptionSettings(card.subscriptionId);
      updateControlledSubscription(workspaceId, card.subscriptionId, { expectedRevision: settings.revision,
        ...(input.actionId === 'less' ? { delivery: 'inbox' } : { enabled: false }) });
      service.transition(card.id, { status: 'resolved', resolution: input.actionId });
      break;
    }
  }
}

function cardEvidence(id: string, workspaceId: string): ProactiveCard['evidence'][number] {
  const db = getSqliteDatabase();
  const split = id.indexOf(':');
  const kind = id.slice(0, split);
  const objectId = id.slice(split + 1);
  if (kind === 'task') {
    const task = db.prepare('SELECT title FROM tasks WHERE task_id = ?').get(objectId) as { title: string } | undefined;
    if (task) return { id, label: task.title, route: `/tasks/${encodeURIComponent(objectId)}` };
  }
  if (kind === 'project') {
    const project = db.prepare('SELECT name FROM projects WHERE project_id = ?').get(objectId) as { name: string } | undefined;
    if (project) return { id, label: project.name, route: `/projects/${encodeURIComponent(objectId)}` };
  }
  if (kind === 'source-item') {
    const source = getKnowledgeSourceItem(objectId);
    if (source && !source.deletedAt && source.metadata.workspaceId === workspaceId) {
      const excerpt = source.normalizedText?.slice(0, 600) ?? '';
      return { id, label: typeof source.metadata.title === 'string' ? source.metadata.title.slice(0, 120) : excerpt.split('\n')[0]?.slice(0, 120) || source.itemType, excerpt };
    }
  }
  const event = db.prepare('SELECT type, occurred_at FROM proactive_events WHERE event_id = ? AND workspace_id = ?').get(id, workspaceId) as { type: string; occurred_at: string } | undefined;
  return { id, label: event ? `${event.type} · ${event.occurred_at}` : kind || 'Evidence' };
}
