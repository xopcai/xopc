import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export function bindMemoryRecordToProject(recordId: string, projectId: string): void {
  const db = getSqliteDatabase();
  if (!db.prepare(`SELECT 1 FROM projects WHERE project_id = ?`).get(projectId)) throw new Error(`Project not found: ${projectId}`);
  if (!db.prepare(`SELECT 1 FROM memory_records WHERE record_id = ?`).get(recordId)) throw new Error(`Memory record not found: ${recordId}`);
  runSqliteWriteTransaction((tx) => {
    const now = Date.now();
    tx.prepare(`UPDATE memory_records SET project_id = ?, updated_at = ? WHERE record_id = ?`).run(projectId, now, recordId);
    tx.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}
