import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

function assertProjectExists(projectId: string): void {
  const row = getSqliteDatabase().prepare(`SELECT 1 FROM projects WHERE project_id = ?`).get(projectId);
  if (!row) throw new Error(`Project not found: ${projectId}`);
}

function assertGoalExists(goalId: string): void {
  const row = getSqliteDatabase().prepare(`SELECT 1 FROM goals WHERE goal_id = ?`).get(goalId);
  if (!row) throw new Error(`Goal not found: ${goalId}`);
}

export function bindGoalToProject(goalId: string, projectId: string): void {
  assertProjectExists(projectId);
  assertGoalExists(goalId);
  runSqliteWriteTransaction((db) => {
    const now = Date.now();
    db.prepare(`UPDATE goals SET project_id = ?, updated_at = ? WHERE goal_id = ?`).run(projectId, now, goalId);
    db.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}

export function unbindGoalFromProject(goalId: string): void {
  assertGoalExists(goalId);
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE goals SET project_id = NULL, updated_at = ? WHERE goal_id = ?`).run(Date.now(), goalId);
  });
}

export function listProjectGoalIds(projectId: string, limit = 100, offset = 0): string[] {
  assertProjectExists(projectId);
  const rows = getSqliteDatabase()
    .prepare(`SELECT goal_id FROM goals WHERE project_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(projectId, Math.min(500, Math.max(1, Math.floor(limit))), Math.max(0, Math.floor(offset))) as Array<{ goal_id: string }>;
  return rows.map((row) => row.goal_id);
}

export function bindGoalsToProject(goalIds: string[], projectId: string): void {
  assertProjectExists(projectId);
  runSqliteWriteTransaction((db) => {
    const now = Date.now();
    const stmt = db.prepare(`UPDATE goals SET project_id = ?, updated_at = ? WHERE goal_id = ?`);
    for (const goalId of goalIds) {
      stmt.run(projectId, now, goalId);
    }
    db.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}
