import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export function bindKnowledgeItemToProject(knowledgeId: string, projectId: string): void {
  const db = getSqliteDatabase();
  if (!db.prepare('SELECT 1 FROM projects WHERE project_id = ?').get(projectId)) {
    throw new Error(`Project not found: ${projectId}`);
  }
  if (!db.prepare('SELECT 1 FROM knowledge_items WHERE knowledge_id = ?').get(knowledgeId)) {
    throw new Error(`Knowledge item not found: ${knowledgeId}`);
  }
  runSqliteWriteTransaction((tx) => {
    const now = Date.now();
    tx.prepare(`UPDATE knowledge_items SET scope_type = 'project', scope_id = ?, updated_at = ?
      WHERE knowledge_id = ?`).run(projectId, now, knowledgeId);
    tx.prepare('UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?')
      .run(now, now, projectId);
  });
}
