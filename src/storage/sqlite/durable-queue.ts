import { randomUUID } from 'node:crypto';
import { requireXopcDatabase } from './connection.js';
import { runSqliteWriteTransaction } from './transaction.js';

export class DurableQueue<T> {
  constructor(readonly queue: string, readonly scope: string) {}
  enqueue(id: string, payload: T, now = Date.now()): void {
    requireXopcDatabase().db.prepare(`INSERT INTO durable_messages(queue, scope, id, payload, enqueued_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(queue, scope, id) DO NOTHING`)
      .run(this.queue, this.scope, id, JSON.stringify(payload), now);
  }
  pending(limit = 2147483647): T[] {
    return (requireXopcDatabase().db.prepare(`SELECT payload FROM durable_messages
      WHERE queue = ? AND scope = ? AND processed_at IS NULL ORDER BY sequence LIMIT ?`)
      .all(this.queue, this.scope, Math.max(0, Math.floor(limit))) as Array<{ payload: string }>)
      .map(row => JSON.parse(row.payload) as T);
  }
  delete(id: string): void {
    requireXopcDatabase().db.prepare('DELETE FROM durable_messages WHERE queue = ? AND scope = ? AND id = ?')
      .run(this.queue, this.scope, id);
  }
  claim(leaseMs: number): { id: string; payload: T; token: string } | null {
    requireXopcDatabase();
    return runSqliteWriteTransaction(db => {
      const now = Date.now();
      const row = db.prepare(`SELECT id, payload FROM durable_messages
        WHERE queue = ? AND scope = ? AND processed_at IS NULL AND (lease_until IS NULL OR lease_until <= ?)
        ORDER BY sequence LIMIT 1`).get(this.queue, this.scope, now) as { id: string; payload: string } | undefined;
      if (!row) return null;
      const token = randomUUID();
      db.prepare('UPDATE durable_messages SET lease_token = ?, lease_until = ? WHERE queue = ? AND scope = ? AND id = ?')
        .run(token, now + leaseMs, this.queue, this.scope, row.id);
      return { id: row.id, payload: JSON.parse(row.payload) as T, token };
    });
  }
  renew(id: string, token: string, leaseMs: number): boolean {
    return requireXopcDatabase().db.prepare(`UPDATE durable_messages SET lease_until = ?
      WHERE queue = ? AND scope = ? AND id = ? AND lease_token = ? AND processed_at IS NULL`)
      .run(Date.now() + leaseMs, this.queue, this.scope, id, token).changes > 0;
  }
  finish(id: string, token: string, success: boolean): void {
    requireXopcDatabase().db.prepare(`UPDATE durable_messages SET processed_at = ?, lease_token = NULL, lease_until = NULL
      WHERE queue = ? AND scope = ? AND id = ? AND lease_token = ?`)
      .run(success ? Date.now() : null, this.queue, this.scope, id, token);
  }
  clearProcessed(olderThanMs?: number): number {
    return Number(requireXopcDatabase().db.prepare(`DELETE FROM durable_messages
      WHERE queue = ? AND scope = ? AND processed_at IS NOT NULL AND processed_at <= ?`)
      .run(this.queue, this.scope, Date.now() - (olderThanMs ?? 0)).changes);
  }
}
