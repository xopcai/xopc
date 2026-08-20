import type { AutomationEvent } from '../automations/domain/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

type OutboxRow = {
  event_id: string;
  event_type: string;
  payload_json: string;
  created_at: number;
};

export class TaskOutboxDispatcher {
  constructor(private readonly publish: (event: AutomationEvent) => void) {}

  drain(limit = 100): number {
    const rows = getSqliteDatabase().prepare(
      `SELECT event_id, event_type, payload_json, created_at
       FROM domain_outbox WHERE published_at IS NULL
       ORDER BY created_at, event_id LIMIT ?`,
    ).all(Math.max(1, Math.min(500, Math.floor(limit)))) as OutboxRow[];
    let published = 0;
    for (const row of rows) {
      try {
        this.publish({
          type: row.event_type,
          source: 'tasks',
          payload: JSON.parse(row.payload_json) as Record<string, unknown>,
          occurredAtMs: row.created_at,
        });
        runSqliteWriteTransaction((db) => {
          db.prepare(
            `UPDATE domain_outbox SET published_at = ?, attempts = attempts + 1
             WHERE event_id = ? AND published_at IS NULL`,
          ).run(Date.now(), row.event_id);
        });
        published += 1;
      } catch {
        getSqliteDatabase().prepare(
          'UPDATE domain_outbox SET attempts = attempts + 1 WHERE event_id = ?',
        ).run(row.event_id);
      }
    }
    return published;
  }
}
