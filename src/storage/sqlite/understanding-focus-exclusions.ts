import { notifyUserContextChange } from '../../user-context/changes.js';
import { getSqliteDatabase } from './transaction.js';

export function listUnderstandingFocusExclusions(): Map<string, string[]> {
  const rows = getSqliteDatabase().prepare('SELECT understanding_id, focus_id FROM understanding_focus_exclusions').all() as Array<{ understanding_id: string; focus_id: string }>;
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const ids = result.get(row.understanding_id) ?? [];
    ids.push(row.focus_id);
    result.set(row.understanding_id, ids);
  }
  return result;
}

export function setUnderstandingFocusExclusion(understandingId: string, focusId: string, excluded: boolean): void {
  const db = getSqliteDatabase();
  if (excluded) {
    db.prepare('INSERT OR IGNORE INTO understanding_focus_exclusions (understanding_id, focus_id, created_at) VALUES (?, ?, ?)').run(understandingId, focusId, Date.now());
  } else {
    db.prepare('DELETE FROM understanding_focus_exclusions WHERE understanding_id = ? AND focus_id = ?').run(understandingId, focusId);
  }
  notifyUserContextChange({ kind: 'understanding', id: understandingId });
}
