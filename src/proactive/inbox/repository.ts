import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';

import type { InboxItem, InboxStatus } from './types.js';

type Row = Record<string, unknown>;
const s = (row: Row, key: string) => String(row[key]);

function itemFromRow(row: Row): InboxItem {
  return {
    id: s(row, 'inbox_item_id'), insightId: s(row, 'insight_id'), status: s(row, 'status') as InboxStatus,
    ...(row.snoozed_until ? { snoozedUntil: s(row, 'snoozed_until') } : {}),
    ...(row.resolution ? { resolution: s(row, 'resolution') } : {}),
    createdAt: s(row, 'created_at'), updatedAt: s(row, 'updated_at'),
    insight: { scenarioKey: s(row, 'scenario_key'), title: s(row, 'title'), summary: s(row, 'summary'),
      whyNow: s(row, 'why_now'), impact: s(row, 'impact'), recommendation: s(row, 'recommendation'), workDone: s(row, 'work_done'),
      ...(row.decision_json ? { decision: JSON.parse(s(row, 'decision_json')) as NonNullable<InboxItem['insight']['decision']> } : {}),
      urgency: s(row, 'urgency') as InboxItem['insight']['urgency'], confidence: Number(row.confidence),
      valueScore: Number(row.value_score), evidenceIds: JSON.parse(s(row, 'evidence_ids_json')) as string[] },
  };
}

const SELECT_ITEM = `SELECT i.*, x.subscription_id, x.scenario_key, x.title, x.summary, x.why_now, x.impact, x.recommendation,
  x.work_done, x.decision_json, x.urgency, x.confidence, x.value_score, x.evidence_ids_json FROM proactive_inbox_items i
  JOIN proactive_insights x ON x.insight_id = i.insight_id`;

export function projectInsightsToInbox(now = new Date()): number {
  return runSqliteWriteTransaction((db) => {
    const missing = db.prepare(`SELECT x.insight_id FROM proactive_insights x
      JOIN proactive_runs r ON r.run_id = x.run_id
      JOIN proactive_signal_batches b ON b.batch_id = r.batch_id
      LEFT JOIN project_monitoring_policies p
        ON b.aggregation_key = 'project:' || p.project_id
      WHERE x.insight_id NOT IN (SELECT insight_id FROM proactive_inbox_items)
        AND (p.project_id IS NULL OR (p.mode != 'observe' AND x.confidence >= p.confidence_threshold))
      ORDER BY x.created_at`).all() as { insight_id: string }[];
    for (const row of missing) {
      const id = randomUUID(); const nowIso = now.toISOString();
      db.prepare(`INSERT INTO proactive_inbox_items (inbox_item_id, insight_id, status, created_at, updated_at)
        VALUES (?, ?, 'unread', ?, ?)`).run(id, row.insight_id, nowIso, nowIso);
      db.prepare(`INSERT INTO proactive_delivery_outbox (delivery_id, inbox_item_id, status, attempt, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, ?, ?, ?)`).run(randomUUID(), id, nowIso, nowIso, nowIso);
    }
    return missing.length;
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
  return (rows as Row[]).map(itemFromRow);
}

export function getInboxItem(id: string): InboxItem | null {
  const row = getSqliteDatabase().prepare(`${SELECT_ITEM} WHERE i.inbox_item_id = ?`).get(id) as Row | undefined;
  return row ? itemFromRow(row) : null;
}

export function transitionInboxItem(id: string, input: { status: InboxStatus; snoozedUntil?: string; resolution?: string }, now = new Date()): InboxItem {
  if (input.status === 'snoozed' && (!input.snoozedUntil || Date.parse(input.snoozedUntil) <= now.getTime())) throw new Error('snoozedUntil must be in the future');
  if (input.status === 'resolved' && !input.resolution?.trim()) throw new Error('resolution is required');
  runSqliteWriteTransaction((db) => {
    const result = db.prepare(`UPDATE proactive_inbox_items SET status = ?, snoozed_until = ?, resolution = ?, updated_at = ? WHERE inbox_item_id = ?`)
      .run(input.status, input.status === 'snoozed' ? input.snoozedUntil! : null, input.status === 'resolved' ? input.resolution!.trim() : null, now.toISOString(), id);
    if (result.changes !== 1) throw new Error('Inbox item not found');
  });
  return getInboxItem(id)!;
}

export function recordDecision(id: string, choice: string, note = '', now = new Date()): InboxItem {
  if (!choice.trim()) throw new Error('choice is required');
  runSqliteWriteTransaction((db) => {
    const row = db.prepare(`SELECT x.decision_json FROM proactive_inbox_items i
      JOIN proactive_insights x ON x.insight_id = i.insight_id WHERE i.inbox_item_id = ?`).get(id) as { decision_json?: string } | undefined;
    if (!row) throw new Error('Inbox item not found');
    if (!row.decision_json) throw new Error('Inbox item does not require a decision');
    const decision = JSON.parse(row.decision_json) as NonNullable<InboxItem['insight']['decision']>;
    if (!decision.options.some((option) => option.id === choice.trim())) throw new Error('choice is not a valid decision option');
    db.prepare('INSERT INTO proactive_decisions (decision_id, inbox_item_id, choice, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), id, choice.trim().slice(0, 200), note.trim().slice(0, 2000), now.toISOString());
    db.prepare("UPDATE proactive_inbox_items SET status = 'resolved', resolution = ?, updated_at = ? WHERE inbox_item_id = ?")
      .run(choice.trim().slice(0, 200), now.toISOString(), id);
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
      error_message = ?, delivered_at = ?, updated_at = ? WHERE delivery_id = ?`)
      .run(error ? (retry ? 'retryable' : 'failed') : 'delivered',
        retry ? new Date(now.getTime() + attempt * 30_000).toISOString() : now.toISOString(),
        error ? String(error instanceof Error ? error.message : error).slice(0, 1000) : null,
        error ? null : now.toISOString(), now.toISOString(), id);
  });
}

export function recoverExpiredDeliveries(now = new Date()): number {
  return Number(runSqliteWriteTransaction((db) => db.prepare(`UPDATE proactive_delivery_outbox SET status = 'retryable', next_attempt_at = ?, lease_expires_at = NULL, updated_at = ?
    WHERE status = 'delivering' AND lease_expires_at <= ?`).run(now.toISOString(), now.toISOString(), now.toISOString()).changes));
}
