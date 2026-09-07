import { requireXopcDatabase } from './connection.js';
import { runSqliteWriteTransaction } from './transaction.js';

/** Small namespaced extension/runtime documents. Domain histories use dedicated tables. */
export class DurableState<T> {
  constructor(readonly namespace: string, readonly scope = '') {}

  get(key: string): T | undefined {
    const row = requireXopcDatabase().db.prepare(
      'SELECT payload FROM durable_state WHERE namespace = ? AND scope = ? AND key = ?',
    ).get(this.namespace, this.scope, key) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as T : undefined;
  }

  set(key: string, value: T): void {
    requireXopcDatabase().db.prepare(`INSERT INTO durable_state(namespace, scope, key, payload)
      VALUES (?, ?, ?, ?) ON CONFLICT(namespace, scope, key) DO UPDATE SET payload = excluded.payload`)
      .run(this.namespace, this.scope, key, JSON.stringify(value));
  }

  delete(key: string): boolean {
    return requireXopcDatabase().db.prepare(
      'DELETE FROM durable_state WHERE namespace = ? AND scope = ? AND key = ?',
    ).run(this.namespace, this.scope, key).changes > 0;
  }

  entries(): Array<[string, T]> {
    return (requireXopcDatabase().db.prepare(
      'SELECT key, payload FROM durable_state WHERE namespace = ? AND scope = ? ORDER BY rowid',
    ).all(this.namespace, this.scope) as Array<{ key: string; payload: string }>)
      .map(row => [row.key, JSON.parse(row.payload) as T]);
  }

  [Symbol.iterator](): Iterator<[string, T]> { return this.entries()[Symbol.iterator](); }

  values(limit?: number, newestFirst = false): T[] {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('Invalid record limit');
    const rows = requireXopcDatabase().db.prepare(`SELECT payload FROM durable_state
      WHERE namespace = ? AND scope = ? ORDER BY rowid ${newestFirst ? 'DESC' : 'ASC'} LIMIT ?`)
      .all(this.namespace, this.scope, limit ?? -1) as Array<{ payload: string }>;
    return rows.map(row => JSON.parse(row.payload) as T);
  }

  update<R>(key: string, operation: (value: T | undefined) => { value: T | undefined; result: R }): R {
    requireXopcDatabase();
    return runSqliteWriteTransaction(() => {
      const next = operation(this.get(key));
      if (next.value === undefined) this.delete(key);
      else this.set(key, next.value);
      return next.result;
    });
  }
}
