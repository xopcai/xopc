import type { DatabaseSync } from 'node:sqlite';

import { runSqliteSavepoint } from '../storage/sqlite/transaction.js';

/** Keeps identity/deduplication rows; removes bounded old payloads only after their work is terminal. */
export function maintainSceneStorage(db: DatabaseSync, now = Date.now()): void {
  const cutoff = now - 90 * 86400000;
  runSqliteSavepoint(db, () => {
    db.prepare('DELETE FROM scene_connector_usage WHERE utc_day < ?').run(Math.floor(cutoff / 86400000));
    db.prepare('DELETE FROM notification_presence WHERE expires_at <= ?').run(now);
    db.prepare('DELETE FROM notification_browser_subscriptions WHERE expires_at <= ?').run(now);
    db.prepare(`DELETE FROM scene_mail_sources WHERE id IN (SELECT s.id FROM scene_mail_sources s
      WHERE s.selected_at < ? AND NOT EXISTS (SELECT 1 FROM scene_activations a, json_each(a.scope_json, '$.ids') ids WHERE ids.value = s.id)
      ORDER BY selected_at LIMIT 100)`).run(now - 30 * 86400000);
    for (const table of ['scene_context_snapshots', 'scene_model_reservations', 'scene_model_usage']) {
      db.prepare(`DELETE FROM ${table} WHERE run_id IN (SELECT DISTINCT r.id FROM scene_runs r JOIN ${table} t ON t.run_id = r.id
        WHERE r.status NOT IN ('running', 'retry_wait') AND r.created_at < ? ORDER BY r.created_at LIMIT 100)`).run(cutoff);
    }
    // Results, intent identities and notification dedupe keys remain until explicit user deletion.
    db.prepare('DELETE FROM notification_attention_budget WHERE dedupe_key IN (SELECT dedupe_key FROM notification_attention_budget WHERE created_at < ? LIMIT 100)').run(cutoff);
  });
}
