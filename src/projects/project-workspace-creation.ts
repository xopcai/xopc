import { isAbsolute } from 'node:path';

import { afterSqliteCommit, getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { canonicalWorkspacePath, ensureWorkspaceDirectory } from './workspace-project.js';

const log = createLogger('ProjectWorkspaceCreation');

export function queueProjectWorkspaceCreation(projectId: string, workspaceRoot: string): void {
  getSqliteDatabase().prepare(`INSERT INTO project_workspace_creation (project_id, workspace_root, created_at)
    VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET workspace_root = excluded.workspace_root,
      created_at = excluded.created_at, attempts = 0, next_attempt_at = 0`).run(projectId, workspaceRoot, Date.now());
  afterSqliteCommit(() => drainProjectWorkspaceCreation(projectId));
}

/** A requested project ID means an explicit retry; background drains honor backoff. */
export function drainProjectWorkspaceCreation(projectId?: string): void {
  const db = getSqliteDatabase();
  const rows = db.prepare(`SELECT q.project_id, q.workspace_root, q.attempts, p.workspace_root AS current_root
    FROM project_workspace_creation q JOIN projects p ON p.project_id = q.project_id
    WHERE (? IS NULL OR q.project_id = ?) AND (? IS NOT NULL OR q.next_attempt_at <= ?)
    ORDER BY q.created_at LIMIT 100`).all(projectId ?? null, projectId ?? null, projectId ?? null, Date.now()) as Array<{
      project_id: string; workspace_root: string; current_root: string | null; attempts: number;
    }>;
  for (const row of rows) {
    if (row.current_root !== row.workspace_root) {
      db.prepare('DELETE FROM project_workspace_creation WHERE project_id = ? AND workspace_root = ?').run(row.project_id, row.workspace_root);
      continue;
    }
    try {
      if (!isAbsolute(row.workspace_root) || canonicalWorkspacePath(row.workspace_root) !== row.workspace_root) {
        throw new Error('Workspace path changed since creation was requested');
      }
      ensureWorkspaceDirectory(row.workspace_root);
      db.prepare('DELETE FROM project_workspace_creation WHERE project_id = ? AND workspace_root = ?').run(row.project_id, row.workspace_root);
    } catch (error) {
      db.prepare(`UPDATE project_workspace_creation SET attempts = attempts + 1, next_attempt_at = ?
        WHERE project_id = ? AND workspace_root = ?`).run(Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 8)), row.project_id, row.workspace_root);
      if (row.attempts === 0) log.warn({ err: error, projectId: row.project_id, path: row.workspace_root }, 'Project workspace creation failed; recovery is pending');
      if (projectId) throw error;
    }
  }
}
