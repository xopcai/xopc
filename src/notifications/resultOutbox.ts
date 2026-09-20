import type { DatabaseSync } from 'node:sqlite';

export interface NotificationResult {
  id: string;
  ownerId: string;
  workspaceId: string;
  subjectId: string;
}

export type PublicationDecision = ({ action: 'settle' } | { action: 'defer'; until: number }) & { reason?: string };

/** Publishes only database work. Transport calls belong to NotificationDispatcher, outside this transaction. */
export class NotificationResultOutbox {
  constructor(private readonly db: DatabaseSync, private readonly publish: (result: NotificationResult) => PublicationDecision,
    private readonly clock: () => number = Date.now) {}

  drainOne(): boolean {
    const now = this.clock();
    this.db.exec('SAVEPOINT notification_result_publication');
    let id: string | undefined;
    let attempt = 0;
    try {
      const row = this.db.prepare(`SELECT * FROM notification_result_outbox
        WHERE (status = 'pending' AND next_attempt_at <= ?)
          OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?))
        ORDER BY next_attempt_at, id LIMIT 1`).get(now, now);
      if (!row) { this.db.exec('RELEASE notification_result_publication'); return false; }
      id = String(row.id); attempt = Number(row.attempt);
      // Taking the SQLite writer lock before publication serializes independent connections.
      this.db.prepare(`UPDATE notification_result_outbox SET status = 'processing', lease_until = ?, updated_at = ? WHERE id = ?`)
        .run(now + 30_000, now, id);
      const decision = this.publish({ id, ownerId: String(row.owner_id), workspaceId: String(row.workspace_id), subjectId: String(row.subject_id) });
      if (!decision || !['settle', 'defer'].includes(decision.action)
        || (decision.reason !== undefined && !/^[a-z][a-z0-9_]{0,79}$/.test(decision.reason))
        || (decision.action === 'defer' && (!Number.isSafeInteger(decision.until) || decision.until <= now))) {
        throw new Error('Notification publication must return a synchronous decision');
      }
      this.db.prepare(`UPDATE notification_result_outbox SET status = ?, next_attempt_at = ?, lease_until = NULL,
        last_error = NULL, decision_reason = ?, settled_at = ?, updated_at = ? WHERE id = ?`)
        .run(decision.action === 'settle' ? 'settled' : 'pending', decision.action === 'defer' ? decision.until : now,
          decision.reason ?? null, decision.action === 'settle' ? now : null, now, id);
      this.db.exec('RELEASE notification_result_publication');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK TO notification_result_publication'); this.db.exec('RELEASE notification_result_publication');
      if (!id) throw error;
      // Publication has no external effects: rolling back also removes budgets, events and dispatch records.
      this.db.prepare(`UPDATE notification_result_outbox SET status = ?, attempt = attempt + 1, next_attempt_at = ?,
        lease_until = NULL, last_error = 'publication_failed', updated_at = ?
        WHERE id = ? AND attempt = ? AND (status = 'pending' OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?)))`)
        .run(attempt + 1 >= 5 ? 'failed' : 'pending', now + 30_000, now, id, attempt, now);
      return true;
    }
  }
}
