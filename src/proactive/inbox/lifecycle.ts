import { createHash } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { insightSourcesAuthorized } from '../execution/authorization.js';

export function withdrawCard(id: string, now = new Date()): void {
  runSqliteWriteTransaction((db) => {
    db.prepare('UPDATE proactive_inbox_items SET withdrawn_at = ?, updated_at = ? WHERE inbox_item_id = ? AND withdrawn_at IS NULL').run(now.toISOString(), now.toISOString(), id);
    db.prepare("UPDATE proactive_delivery_outbox SET status = 'delivered', error_message = 'source_withdrawn' WHERE inbox_item_id = ? AND status <> 'delivered'").run(id);
    db.prepare("UPDATE proactive_insights SET action_status = 'rejected', action_error = 'source_withdrawn' WHERE insight_id = (SELECT insight_id FROM proactive_inbox_items WHERE inbox_item_id = ?) AND action_status IN ('pending', 'approval_required', 'failed')").run(id);
    db.prepare(`UPDATE notification_events SET title_en = 'Update withdrawn', title_zh = '消息已撤回', body_en = NULL, body_zh = NULL
      WHERE event_type = 'proactive.insight' AND json_extract(target_json, '$.inboxItemId') = ?`).run(id);
    db.prepare(`UPDATE proactive_web_push_deliveries SET status = 'failed', lease_until = NULL, last_error = 'source_withdrawn'
      WHERE inbox_item_id = ? AND status IN ('pending', 'sending')`).run(id);
    db.prepare(`UPDATE notification_deliveries SET status = 'dead', updated_at = ? WHERE status IN ('pending', 'accepted') AND event_id IN
      (SELECT event_id FROM notification_events WHERE event_type = 'proactive.insight' AND json_extract(target_json, '$.inboxItemId') = ?)`).run(now.getTime(), id);
    db.prepare(`UPDATE proactive_channel_deliveries SET status = 'cancelled', lease_until = NULL, last_error = 'source_withdrawn' WHERE status IN ('pending', 'sending') AND notification_id IN
      (SELECT event_id FROM notification_events WHERE event_type = 'proactive.insight' AND json_extract(target_json, '$.inboxItemId') = ?)`).run(id);
    db.prepare('DELETE FROM proactive_digest_queue WHERE inbox_item_id = ?').run(id);
  });
}

/** Conservative correlation: the same scope, evidence subjects and requested outcome. */
export function insightCorrelation(insightId: string): string {
  const row = getSqliteDatabase().prepare(`SELECT s.workspace_id, b.aggregation_key, x.evidence_ids_json, x.proposed_action_json, x.recommendation
    FROM proactive_insights x JOIN proactive_runs r USING(run_id) JOIN proactive_signal_batches b USING(batch_id)
    JOIN proactive_scenario_subscriptions s ON s.subscription_id = x.subscription_id WHERE x.insight_id = ?`).get(insightId) as
    { workspace_id: string; aggregation_key: string; evidence_ids_json: string; proposed_action_json: string | null; recommendation: string } | undefined;
  if (!row) return insightId;
  const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const evidence = (JSON.parse(row.evidence_ids_json) as string[]).filter((id) => /^(task|project|source-item|automation-run):/.test(id)).sort();
  if (!evidence.length) return insightId;
  const action = row.proposed_action_json ? JSON.parse(row.proposed_action_json) as { id: string; input: unknown } : null;
  return createHash('sha256').update(JSON.stringify([row.workspace_id, row.aggregation_key, evidence,
    normalize(action ? JSON.stringify([action.id, action.input]) : row.recommendation)])).digest('hex');
}

export function reconcileCards(now = new Date()): number {
  return runSqliteWriteTransaction((db) => {
    const rows = db.prepare(`SELECT i.inbox_item_id, i.insight_id, i.correlation_key FROM proactive_inbox_items i
      LEFT JOIN proactive_card_review_state r USING(inbox_item_id) WHERE i.withdrawn_at IS NULL
      ORDER BY COALESCE(r.checked_at, ''), i.created_at LIMIT 200`).all() as Array<{ inbox_item_id: string; insight_id: string; correlation_key: string | null }>;
    let withdrawn = 0;
    for (const row of rows) {
      if (!insightSourcesAuthorized(row.insight_id)) { withdrawCard(row.inbox_item_id, now); withdrawn++; }
      else {
        const correlation = insightCorrelation(row.insight_id);
        if (row.correlation_key !== correlation) db.prepare('UPDATE proactive_inbox_items SET correlation_key = ? WHERE inbox_item_id = ?').run(correlation, row.inbox_item_id);
      }
      db.prepare(`INSERT INTO proactive_card_review_state VALUES (?, ?) ON CONFLICT(inbox_item_id) DO UPDATE SET checked_at = excluded.checked_at`).run(row.inbox_item_id, now.toISOString());
    }
    return withdrawn;
  });
}
