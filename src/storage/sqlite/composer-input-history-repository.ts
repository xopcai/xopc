import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export const COMPOSER_INPUT_HISTORY_LIMIT = 100;

export interface ComposerInputHistoryItem {
  id: number;
  text: string;
  createdAt: number;
}

type Row = { id: number; text: string; created_at: number };

function fromRow(row: Row): ComposerInputHistoryItem {
  return { id: row.id, text: row.text, createdAt: row.created_at };
}

export function listComposerInputHistory(limit = COMPOSER_INPUT_HISTORY_LIMIT): ComposerInputHistoryItem[] {
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(COMPOSER_INPUT_HISTORY_LIMIT, Math.max(1, Math.trunc(limit)))
    : COMPOSER_INPUT_HISTORY_LIMIT;
  const rows = getSqliteDatabase()
    .prepare('SELECT id, text, created_at FROM composer_input_history ORDER BY id DESC LIMIT ?')
    .all(boundedLimit) as Row[];
  return rows.map(fromRow);
}

export function appendComposerInputHistory(
  text: string,
  now = Date.now(),
): { item: ComposerInputHistoryItem; inserted: boolean } {
  const normalized = text.trim();
  if (!normalized) throw new Error('Composer history text is required');

  return runSqliteWriteTransaction((db) => {
    const latest = db
      .prepare('SELECT id, text, created_at FROM composer_input_history ORDER BY id DESC LIMIT 1')
      .get() as Row | undefined;
    if (latest?.text === normalized) return { item: fromRow(latest), inserted: false };

    const result = db
      .prepare('INSERT INTO composer_input_history (text, created_at) VALUES (?, ?)')
      .run(normalized, now);
    const id = Number(result.lastInsertRowid);
    db.prepare(
      `DELETE FROM composer_input_history
       WHERE id NOT IN (SELECT id FROM composer_input_history ORDER BY id DESC LIMIT ?)`,
    ).run(COMPOSER_INPUT_HISTORY_LIMIT);
    return { item: { id, text: normalized, createdAt: now }, inserted: true };
  });
}

export function clearComposerInputHistory(): number {
  return Number(runSqliteWriteTransaction((db) =>
    db.prepare('DELETE FROM composer_input_history').run().changes,
  ));
}
