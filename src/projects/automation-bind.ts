import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export function bindAutomationToProject(automationId: string, projectId: string): void {
  const db = getSqliteDatabase();
  if (!db.prepare(`SELECT 1 FROM projects WHERE project_id = ?`).get(projectId)) throw new Error(`Project not found: ${projectId}`);
  if (!db.prepare(`SELECT 1 FROM automations WHERE automation_id = ?`).get(automationId)) throw new Error(`Automation not found: ${automationId}`);
  runSqliteWriteTransaction((tx) => {
    const now = Date.now();
    tx.prepare(`UPDATE automations SET project_id = ?, updated_at_ms = ? WHERE automation_id = ?`).run(projectId, now, automationId);
    tx.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}
