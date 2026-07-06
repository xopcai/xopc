import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export function bindWorkflowRunToProject(runId: string, projectId: string): void {
  const db = getSqliteDatabase();
  if (!db.prepare(`SELECT 1 FROM projects WHERE project_id = ?`).get(projectId)) throw new Error(`Project not found: ${projectId}`);
  if (!db.prepare(`SELECT 1 FROM workflow_runs WHERE run_id = ?`).get(runId)) throw new Error(`Workflow run not found: ${runId}`);
  runSqliteWriteTransaction((tx) => {
    const now = Date.now();
    tx.prepare(`UPDATE workflow_runs SET project_id = ? WHERE run_id = ?`).run(projectId, runId);
    tx.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}
