import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type HomeAttentionSubjectKind = 'automation_run' | 'workflow_run';

export function acknowledgeHomeAttention(
  subjectKind: HomeAttentionSubjectKind,
  subjectId: string,
  acknowledgedAt = Date.now(),
): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO home_attention_acknowledgements (subject_kind, subject_id, acknowledged_at)
      VALUES (?, ?, ?)
      ON CONFLICT(subject_kind, subject_id) DO UPDATE SET
        acknowledged_at = excluded.acknowledged_at
    `).run(subjectKind, subjectId, acknowledgedAt);
  });
}

export function isHomeAttentionAcknowledged(
  subjectKind: HomeAttentionSubjectKind,
  subjectId: string,
): boolean {
  const row = getSqliteDatabase()
    .prepare(`
      SELECT 1
      FROM home_attention_acknowledgements
      WHERE subject_kind = ? AND subject_id = ?
    `)
    .get(subjectKind, subjectId);
  return row !== undefined;
}
