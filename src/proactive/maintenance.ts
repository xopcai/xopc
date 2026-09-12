import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

const RETENTION_DAYS = 90;

export function pruneProactiveHistory(now = new Date()): { batches: number; events: number } {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
  return runSqliteWriteTransaction((db) => {
    const batches = db.prepare(`DELETE FROM proactive_signal_batches
      WHERE updated_at < ? AND status IN ('processed', 'ignored', 'failed_permanent', 'expired')`)
      .run(cutoff).changes;
    const events = db.prepare(`DELETE FROM proactive_events
      WHERE observed_at < ? AND NOT EXISTS (
        SELECT 1 FROM proactive_batch_events batch_event
        WHERE batch_event.event_id = proactive_events.event_id
      )`).run(cutoff).changes;
    db.prepare('DELETE FROM proactive_notification_budget WHERE created_at < ?').run(cutoff);
    db.prepare('DELETE FROM proactive_presence WHERE expires_at <= ?').run(now.getTime());
    db.prepare('DELETE FROM proactive_delivery_decisions WHERE created_at < ?').run(cutoff);
    db.prepare('DELETE FROM proactive_preview_runs WHERE created_at < ?').run(cutoff);
    db.prepare('DELETE FROM proactive_push_probes WHERE created_at < ?').run(Date.parse(cutoff));
    db.prepare('DELETE FROM proactive_digest_queue WHERE consumed_at < ?').run(cutoff);
    db.prepare('DELETE FROM proactive_digests WHERE created_at < ?').run(cutoff);
    return { batches: Number(batches), events: Number(events) };
  });
}
