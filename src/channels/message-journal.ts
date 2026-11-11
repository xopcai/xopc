import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

const MAX_PENDING = 500;
const MAX_PENDING_BYTES = 16 * 1024 * 1024;
const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60_000;

type JournalEntry<T> = { id: string; payload: T };
type StoredEntry = { id: string; payload: string; enqueued_at: number };

/** Persists channel messages, their dispatch receipts, and optional platform cursors. */
export class ChannelMessageJournal<T, Cursor> {
  private readonly cursors: DurableState<Cursor>;
  private readonly queue: string;
  private lastPrunedAt = 0;

  constructor(channel: string, private readonly scope: string) {
    this.queue = `channel-journal:${channel}`;
    this.cursors = new DurableState<Cursor>(this.queue);
  }

  cursor(): Cursor | undefined {
    return this.cursors.get(this.scope);
  }

  accept(entries: JournalEntry<T>[], cursor?: Cursor): string[] {
    requireXopcDatabase();
    return runSqliteWriteTransaction(db => {
      const insert = db.prepare(`INSERT INTO durable_messages(queue, scope, id, payload, enqueued_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(queue, scope, id) DO NOTHING`);
      const now = Date.now();
      if (now - this.lastPrunedAt > 60 * 60_000) {
        db.prepare(`DELETE FROM durable_messages WHERE queue = ? AND scope = ? AND processed_at <= ?`)
          .run(this.queue, this.scope, now - RECEIPT_RETENTION_MS);
        this.lastPrunedAt = now;
      }
      const inserted: string[] = [];
      for (const entry of entries) {
        if (insert.run(this.queue, this.scope, entry.id, JSON.stringify(entry.payload), now).changes > 0) {
          inserted.push(entry.id);
        }
      }
      if (entries.length) {
        const pending = db.prepare(`SELECT count(*) AS count, coalesce(sum(length(CAST(payload AS BLOB))), 0) AS bytes
          FROM durable_messages WHERE queue = ? AND scope = ? AND processed_at IS NULL`)
          .get(this.queue, this.scope) as { count: number; bytes: number };
        if (pending.count > MAX_PENDING || pending.bytes > MAX_PENDING_BYTES) {
          throw new Error('Channel inbox capacity exceeded');
        }
      }
      if (cursor !== undefined) this.cursors.set(this.scope, cursor);
      return inserted;
    });
  }

  pending(limit = 100): Array<JournalEntry<T> & { enqueuedAt: number }> {
    const rows = requireXopcDatabase().db.prepare(`SELECT id, payload, enqueued_at FROM durable_messages
      WHERE queue = ? AND scope = ? AND processed_at IS NULL AND lease_token IS NULL
      ORDER BY sequence LIMIT ?`).all(this.queue, this.scope, limit) as StoredEntry[];
    return rows.map(row => ({ id: row.id, payload: JSON.parse(row.payload) as T, enqueuedAt: row.enqueued_at }));
  }

  begin(id: string, replayable = false): boolean {
    return requireXopcDatabase().db.prepare(`UPDATE durable_messages SET lease_token = ?
      WHERE queue = ? AND scope = ? AND id = ? AND processed_at IS NULL AND lease_token IS NULL`)
      .run(replayable ? 'preparing' : 'dispatching', this.queue, this.scope, id).changes > 0;
  }

  finish(id: string, outcome: 'completed' | 'interrupted'): void {
    // Keep only the receipt after dispatch. Raw updates can contain private message bodies or media credentials.
    requireXopcDatabase().db.prepare(`UPDATE durable_messages
      SET processed_at = ?, lease_token = ?, payload = '{}'
      WHERE queue = ? AND scope = ? AND id = ? AND processed_at IS NULL AND lease_token IN ('dispatching', 'preparing')`)
      .run(Date.now(), outcome, this.queue, this.scope, id);
  }

  finishBatch(entries: ReadonlyArray<{ id: string; outcome: 'completed' | 'interrupted' }>): void {
    if (!entries.length) return;
    runSqliteWriteTransaction(() => {
      for (const { id, outcome } of entries) this.finish(id, outcome);
    });
  }

  recoverInterrupted(): number {
    const db = requireXopcDatabase().db;
    db.prepare(`UPDATE durable_messages SET lease_token = NULL
      WHERE queue = ? AND scope = ? AND processed_at IS NULL AND lease_token = 'preparing'`)
      .run(this.queue, this.scope);
    const count = db.prepare(`UPDATE durable_messages SET processed_at = ?, lease_token = 'interrupted', payload = '{}'
      WHERE queue = ? AND scope = ? AND processed_at IS NULL AND lease_token = 'dispatching'`)
      .run(Date.now(), this.queue, this.scope).changes;
    db.prepare(`DELETE FROM durable_messages WHERE queue = ? AND scope = ? AND processed_at <= ?`)
      .run(this.queue, this.scope, Date.now() - RECEIPT_RETENTION_MS);
    return Number(count);
  }
}
