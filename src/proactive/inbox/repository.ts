import { insightSourcesAuthorized } from '../execution/authorization.js';
import { effectiveProactivePolicy } from '../policy/service.js';
import { randomUUID } from 'node:crypto';

import type { ProjectMonitoringPolicy } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { decideProactiveDisposition, nextQuietHoursEnd, proactiveDispositionReason } from '../../tasks/project-monitoring-service.js';

import type { InboxItem, InboxStatus } from './types.js';

type Row = Record<string, unknown>;
const s = (row: Row, key: string) => String(row[key]);

function itemFromRow(row: Row): InboxItem {
  const attentionKind = row.action_status === 'completed'
    ? 'receipt'
    : row.decision_json || row.action_status === 'approval_required'
      ? 'decision'
      : 'information';
  return {
    id: s(row, 'inbox_item_id'), insightId: s(row, 'insight_id'), subscriptionId: s(row, 'subscription_id'),
    withdrawnAt: row.withdrawn_at ? s(row, 'withdrawn_at') : undefined, correlationKey: row.correlation_key ? s(row, 'correlation_key') : undefined,
    revision: Number(row.revision), notificationRevision: Number(row.notification_revision),
    ...(row.expires_at ? { expiresAt: s(row, 'expires_at') } : {}), status: s(row, 'status') as InboxStatus,
    ...(row.snoozed_until ? { snoozedUntil: s(row, 'snoozed_until') } : {}),
    ...(row.resolution ? { resolution: s(row, 'resolution') } : {}),
    createdAt: s(row, 'created_at'), updatedAt: s(row, 'updated_at'),
    insight: { scenarioKey: s(row, 'scenario_key'), title: s(row, 'title'), summary: s(row, 'summary'),
      whyNow: s(row, 'why_now'), impact: s(row, 'impact'), recommendation: s(row, 'recommendation'), workDone: s(row, 'work_done'),
      ...(row.decision_json ? { decision: JSON.parse(s(row, 'decision_json')) as NonNullable<InboxItem['insight']['decision']> } : {}),
      ...(row.proposed_action_json ? { proposedAction: JSON.parse(s(row, 'proposed_action_json')) as NonNullable<InboxItem['insight']['proposedAction']> } : {}),
      disposition: s(row, 'disposition') as InboxItem['insight']['disposition'],
      dispositionReason: s(row, 'disposition_reason'),
      ...(row.action_status ? { actionStatus: s(row, 'action_status') as NonNullable<InboxItem['insight']['actionStatus']> } : {}),
      ...(row.action_result_json ? { actionResult: JSON.parse(s(row, 'action_result_json')) as Record<string, unknown> } : {}),
      ...(row.action_error ? { actionError: s(row, 'action_error') } : {}),
      urgency: s(row, 'urgency') as InboxItem['insight']['urgency'], confidence: Number(row.confidence),
      valueScore: Number(row.value_score), evidenceIds: JSON.parse(s(row, 'evidence_ids_json')) as string[],
      attentionKind },
  };
}

const SELECT_ITEM = `SELECT i.*, x.subscription_id, x.scenario_key, x.title, x.summary, x.why_now, x.impact, x.recommendation,
  x.work_done, x.decision_json, x.proposed_action_json, x.disposition, x.disposition_reason,
  x.action_status, x.action_result_json, x.action_error, x.urgency, x.confidence, x.value_score, x.evidence_ids_json FROM proactive_inbox_items i
  JOIN proactive_insights x ON x.insight_id = i.insight_id`;

export function projectInsightsToInbox(now = new Date()): number {
  return runSqliteWriteTransaction((db) => {
    const missing = db.prepare(`SELECT x.insight_id, x.subscription_id, x.scenario_key, x.urgency, x.confidence, x.value_score, x.decision_json,
      x.proposed_action_json, b.aggregation_key, p.project_id, p.mode, p.quiet_hours_json,
      p.allowed_actions_json, p.confidence_threshold FROM proactive_insights x
      JOIN proactive_runs r ON r.run_id = x.run_id
      JOIN proactive_signal_batches b ON b.batch_id = r.batch_id
      LEFT JOIN project_monitoring_policies p
        ON b.aggregation_key = 'project:' || p.project_id
      WHERE x.disposition IS NULL ORDER BY x.created_at`).all() as Array<Record<string, unknown>>;
    let projected = 0;
    for (const row of missing) {
      const attention = effectiveProactivePolicy(String(row.subscription_id), now);
      if (!attention.enabled) {
        db.prepare("UPDATE proactive_insights SET disposition = 'record_silently', disposition_reason = 'Proactive subscription paused' WHERE insight_id = ?").run(String(row.insight_id));
        continue;
      }
      const aggregationKey = String(row.aggregation_key);
      const projectId = aggregationKey.startsWith('project:') ? aggregationKey.slice('project:'.length) : undefined;
      const policy: ProjectMonitoringPolicy = projectId
        ? row.project_id
          ? {
              projectId,
              mode: String(row.mode) as ProjectMonitoringPolicy['mode'],
              ...(row.quiet_hours_json ? { quietHours: JSON.parse(String(row.quiet_hours_json)) as ProjectMonitoringPolicy['quietHours'] } : {}),
              allowedActions: JSON.parse(String(row.allowed_actions_json)) as string[],
              confidenceThreshold: Number(row.confidence_threshold),
              scenarios: [],
              configured: true,
            }
          : { projectId, mode: 'observe', allowedActions: [], confidenceThreshold: 0.75, scenarios: [], configured: false }
        : { projectId: '', mode: 'ask_before_action', allowedActions: [], confidenceThreshold: 0, scenarios: [], configured: false };
      const action = row.proposed_action_json
        ? JSON.parse(String(row.proposed_action_json)) as NonNullable<InboxItem['insight']['proposedAction']>
        : undefined;
      const dispositionInput = {
        confidence: Number(row.confidence),
        valueScore: Number(row.value_score),
        risk: action?.risk ?? 'low' as const,
        ...(action ? { actionId: action.id } : {}),
        requiresApproval: !action && Boolean(row.decision_json),
      };
      const legacyDisposition = action && !projectId ? 'show_in_work' : decideProactiveDisposition(policy, dispositionInput);
      const disposition = attention.settings.managed && legacyDisposition === 'record_silently'
        ? action && projectId ? 'request_approval' : 'show_in_work' : legacyDisposition;
      const reason = action && !projectId
        ? 'Proposed project action cannot run outside a project scope'
        : proactiveDispositionReason(policy, dispositionInput, disposition);
      const actionStatus = action
        ? disposition === 'auto_execute' ? 'pending'
          : disposition === 'request_approval' ? 'approval_required'
            : disposition === 'show_in_work' ? 'not_authorized' : null
        : null;
      const nowIso = now.toISOString();
      db.prepare(`UPDATE proactive_insights SET disposition = ?, disposition_reason = ?, action_status = ?,
        disposition_at = ?, action_updated_at = ? WHERE insight_id = ? AND disposition IS NULL`)
        .run(disposition, reason, actionStatus, nowIso, actionStatus ? nowIso : null, String(row.insight_id));
      if (disposition === 'record_silently') continue;
      const previous = attention.settings.managed ? db.prepare(`SELECT i.inbox_item_id, x.urgency, x.decision_json,
        o.delivered_at FROM proactive_inbox_items i JOIN proactive_insights x USING(insight_id)
        JOIN proactive_runs r USING(run_id) JOIN proactive_signal_batches b USING(batch_id)
        LEFT JOIN proactive_delivery_outbox o USING(inbox_item_id)
        WHERE x.subscription_id = ? AND x.scenario_key = ? AND b.aggregation_key = ?
        AND i.withdrawn_at IS NULL AND i.status IN ('unread', 'read', 'snoozed') AND (i.expires_at IS NULL OR i.expires_at > ?)
        AND (x.action_status IS NULL OR x.action_status IN ('not_authorized', 'rejected', 'failed'))
        ORDER BY i.updated_at DESC LIMIT 1`).get(String(row.subscription_id), String(row.scenario_key), aggregationKey, nowIso) as
        { inbox_item_id: string; urgency: string; decision_json: string | null; delivered_at: string | null } | undefined : undefined;
      const id = previous?.inbox_item_id ?? randomUUID();
      const urgencyRank: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
      const materialChange = previous && ((urgencyRank[String(row.urgency)] ?? 0) > (urgencyRank[previous.urgency] ?? 0)
        || row.decision_json !== previous.decision_json);
      if (previous) {
        db.prepare(`UPDATE proactive_inbox_items SET insight_id = ?, updated_at = ?,
          notification_revision = notification_revision + ? WHERE inbox_item_id = ?`)
          .run(String(row.insight_id), nowIso, materialChange ? 1 : 0, id);
      } else {
        db.prepare(`INSERT INTO proactive_inbox_items (inbox_item_id, insight_id, status, created_at, updated_at)
          VALUES (?, ?, 'unread', ?, ?)`).run(id, String(row.insight_id), nowIso, nowIso);
      }
      if (attention.settings.managed) {
        const meeting = db.prepare(`SELECT e.payload_json FROM proactive_events e
          JOIN proactive_batch_events be ON be.event_id = e.event_id
          JOIN proactive_runs r ON r.batch_id = be.batch_id JOIN proactive_insights x ON x.run_id = r.run_id
          WHERE x.insight_id = ? AND e.type = 'connected_source.calendar_window.v1' ORDER BY e.occurred_at DESC LIMIT 1`).get(String(row.insight_id)) as { payload_json: string } | undefined;
        const meetingStart = meeting ? JSON.parse(meeting.payload_json).meetingStartsAt : undefined;
        const expiresAt = typeof meetingStart === 'string' && Number.isFinite(Date.parse(meetingStart)) ? meetingStart : new Date(now.getTime() + 7 * 86400000).toISOString();
        db.prepare('UPDATE proactive_inbox_items SET expires_at = ? WHERE inbox_item_id = ?').run(expiresAt, id);
      }
      const quietEnd = nextQuietHoursEnd(policy.quietHours, now)?.getTime() ?? now.getTime();
      const cooldownEnd = previous?.delivered_at ? Date.parse(previous.delivered_at) + 4 * 3600000 : now.getTime();
      const nextAttemptAt = new Date(Math.max(quietEnd, cooldownEnd)).toISOString();
      if (previous && !materialChange) { projected += 1; continue; }
      db.prepare(`INSERT INTO proactive_delivery_outbox (delivery_id, inbox_item_id, status, attempt, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, ?, ?, ?)
        ON CONFLICT(inbox_item_id) DO UPDATE SET delivery_id = excluded.delivery_id, status = 'pending', attempt = 0, next_attempt_at = excluded.next_attempt_at, lease_expires_at = NULL, updated_at = excluded.updated_at`).run(randomUUID(), id, nextAttemptAt, nowIso, nowIso);
      projected += 1;
    }
    return projected;
  });
}

export function wakeSnoozedItems(now = new Date()): number {
  return Number(runSqliteWriteTransaction((db) => db.prepare(`UPDATE proactive_inbox_items SET status = 'unread', snoozed_until = NULL, updated_at = ?
    WHERE status = 'snoozed' AND snoozed_until <= ?`).run(now.toISOString(), now.toISOString()).changes));
}

export function listInbox(input: { status?: InboxStatus; limit?: number } = {}): InboxItem[] {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const rows = input.status
    ? getSqliteDatabase().prepare(`${SELECT_ITEM} WHERE i.status = ? ORDER BY i.updated_at DESC LIMIT ?`).all(input.status, limit)
    : getSqliteDatabase().prepare(`${SELECT_ITEM} ORDER BY i.updated_at DESC LIMIT ?`).all(limit);
  return (rows as Row[]).map(itemFromRow).filter((item) => !item.withdrawnAt && insightSourcesAuthorized(item.insightId));
}

export function getInboxItem(id: string): InboxItem | null {
  const row = getSqliteDatabase().prepare(`${SELECT_ITEM} WHERE i.inbox_item_id = ?`).get(id) as Row | undefined;
  return row ? itemFromRow(row) : null;
}

export function transitionInboxItem(id: string, input: { status: InboxStatus; snoozedUntil?: string; resolution?: string }, now = new Date()): InboxItem {
  if (input.status === 'snoozed' && (!input.snoozedUntil || (!Number.isFinite(Date.parse(input.snoozedUntil)) || Date.parse(input.snoozedUntil) <= now.getTime()))) throw new Error('snoozedUntil must be in the future');
  if (input.status === 'resolved' && !input.resolution?.trim()) throw new Error('resolution is required');
  runSqliteWriteTransaction((db) => {
    const current = getInboxItem(id);
    if (!current || current.withdrawnAt || !insightSourcesAuthorized(current.insightId)) throw new Error('Inbox item not found');
    if ((current.status === 'resolved' || (current.expiresAt && Date.parse(current.expiresAt) <= now.getTime())) && input.status !== 'resolved') throw new Error('Card is no longer actionable');
    const result = db.prepare(`UPDATE proactive_inbox_items SET status = ?, snoozed_until = ?, resolution = ?, updated_at = ? WHERE inbox_item_id = ?`)
      .run(input.status, input.status === 'snoozed' ? input.snoozedUntil! : null, input.status === 'resolved' ? input.resolution!.trim() : null, now.toISOString(), id);
    if (result.changes !== 1) throw new Error('Inbox item not found');
  });
  return getInboxItem(id)!;
}

export function recordDecision(id: string, choice: string, note = '', now = new Date()): InboxItem {
  if (!choice.trim()) throw new Error('choice is required');
  const activeItem = getInboxItem(id);
  if (!activeItem || activeItem.withdrawnAt || !insightSourcesAuthorized(activeItem.insightId)) throw new Error('Inbox item not found');
  if (activeItem?.expiresAt && Date.parse(activeItem.expiresAt) <= now.getTime()) throw new Error('Card expired');
  if (choice === 'approve' && activeItem?.subscriptionId && !effectiveProactivePolicy(activeItem.subscriptionId, now).enabled) throw new Error('Subscription paused');
  runSqliteWriteTransaction((db) => {
    const row = db.prepare(`SELECT i.status, x.decision_json, x.action_status FROM proactive_inbox_items i
      JOIN proactive_insights x ON x.insight_id = i.insight_id WHERE i.inbox_item_id = ?`).get(id) as {
        status: InboxStatus;
        decision_json: string | null;
        action_status: string | null;
      } | undefined;
    if (!row) throw new Error('Inbox item not found');
    if (row.status === 'resolved') throw new Error('Inbox item is already resolved');
    if (!row.decision_json) throw new Error('Inbox item does not require a decision');
    const decision = JSON.parse(row.decision_json) as NonNullable<InboxItem['insight']['decision']>;
    if (!decision.options.some((option) => option.id === choice.trim())) throw new Error('choice is not a valid decision option');
    db.prepare('INSERT INTO proactive_decisions (decision_id, inbox_item_id, choice, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, choice.trim().slice(0, 200), note.trim().slice(0, 2000), now.toISOString());
    db.prepare("UPDATE proactive_inbox_items SET status = 'resolved', resolution = ?, updated_at = ? WHERE inbox_item_id = ?")
      .run(choice.trim().slice(0, 200), now.toISOString(), id);
    if (row.action_status === 'approval_required') {
      db.prepare(`UPDATE proactive_insights SET action_status = ?, action_updated_at = ?
        WHERE insight_id = (SELECT insight_id FROM proactive_inbox_items WHERE inbox_item_id = ?)
        AND action_status = 'approval_required'`)
        .run(choice === 'approve' ? 'pending' : 'rejected', now.toISOString(), id);
    }
  });
  return getInboxItem(id)!;
}

export function recordFeedback(id: string, rating: 'useful' | 'not_useful', note = '', now = new Date()): void {
  runSqliteWriteTransaction((db) => {
    if (!db.prepare('SELECT 1 FROM proactive_inbox_items WHERE inbox_item_id = ?').get(id)) throw new Error('Inbox item not found');
    db.prepare('INSERT INTO proactive_feedback (feedback_id, inbox_item_id, rating, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, rating, note.trim().slice(0, 2000), now.toISOString());
  });
}

export function getInboxSubscriptionId(id: string): string {
  const item = getSqliteDatabase().prepare(`${SELECT_ITEM} WHERE i.inbox_item_id = ?`).get(id) as Row | undefined;
  if (!item) throw new Error('Inbox item not found');
  return s(item, 'subscription_id');
}

export interface OutboxClaim { id: string; item: InboxItem; attempt: number }
export function claimDelivery(now = new Date()): OutboxClaim | null {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(`SELECT delivery_id, inbox_item_id, attempt FROM proactive_delivery_outbox
      WHERE status IN ('pending', 'retryable') AND next_attempt_at <= ? ORDER BY created_at LIMIT 1`).get(now.toISOString()) as Row | undefined;
    if (!row) return null;
    db.prepare(`UPDATE proactive_delivery_outbox SET status = 'delivering', attempt = attempt + 1, lease_expires_at = ?, updated_at = ? WHERE delivery_id = ?`)
      .run(new Date(now.getTime() + 60_000).toISOString(), now.toISOString(), s(row, 'delivery_id'));
    return { id: s(row, 'delivery_id'), item: getInboxItem(s(row, 'inbox_item_id'))!, attempt: Number(row.attempt) + 1 };
  });
}

export function finishDelivery(id: string, error?: unknown, attempt = 1, now = new Date()): void {
  runSqliteWriteTransaction((db) => {
    const retry = Boolean(error) && attempt < 5;
    db.prepare(`UPDATE proactive_delivery_outbox SET status = ?, next_attempt_at = ?, lease_expires_at = NULL,
      error_message = ?, delivered_at = ?, updated_at = ? WHERE delivery_id = ? AND status = 'delivering' AND attempt = ?`)
      .run(error ? (retry ? 'retryable' : 'failed') : 'delivered',
        retry ? new Date(now.getTime() + attempt * 30_000).toISOString() : now.toISOString(),
        error ? String(error instanceof Error ? error.message : error).slice(0, 1000) : null,
        error ? null : now.toISOString(), now.toISOString(), id, attempt);
  });
}

export function recoverExpiredDeliveries(now = new Date()): number {
  return Number(runSqliteWriteTransaction((db) => db.prepare(`UPDATE proactive_delivery_outbox SET status = 'retryable', next_attempt_at = ?, lease_expires_at = NULL, updated_at = ?
    WHERE status = 'delivering' AND lease_expires_at <= ?`).run(now.toISOString(), now.toISOString(), now.toISOString()).changes));
}

export function deferDelivery(id: string, attempt: number, retryAt: string): void {
  getSqliteDatabase().prepare("UPDATE proactive_delivery_outbox SET status = 'pending', attempt = attempt - 1, next_attempt_at = ?, lease_expires_at = NULL WHERE delivery_id = ? AND status = 'delivering' AND attempt = ?").run(retryAt, id, attempt);
}
