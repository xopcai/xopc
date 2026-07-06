import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

function projectExists(projectId: string): boolean {
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM projects WHERE project_id = ?`).get(projectId));
}

function assertProjectExists(projectId: string): void {
  if (!projectExists(projectId)) {
    throw new Error(`Project not found: ${projectId}`);
  }
}

function assertSessionExists(sessionKey: string): void {
  const row = getSqliteDatabase().prepare(`SELECT 1 FROM sessions WHERE session_key = ?`).get(sessionKey);
  if (!row) throw new Error(`Session not found: ${sessionKey}`);
}

export function bindSessionToProject(sessionKey: string, projectId: string): void {
  assertProjectExists(projectId);
  assertSessionExists(sessionKey);
  runSqliteWriteTransaction((db) => {
    const now = Date.now();
    db.prepare(`UPDATE sessions SET project_id = ?, updated_at = ? WHERE session_key = ?`).run(projectId, now, sessionKey);
    db.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}

export function unbindSessionFromProject(sessionKey: string): void {
  assertSessionExists(sessionKey);
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE sessions SET project_id = NULL, updated_at = ? WHERE session_key = ?`).run(Date.now(), sessionKey);
  });
}

export function listProjectSessionKeys(projectId: string, limit = 100, offset = 0): string[] {
  assertProjectExists(projectId);
  const rows = getSqliteDatabase()
    .prepare(`SELECT session_key FROM sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(projectId, Math.min(500, Math.max(1, Math.floor(limit))), Math.max(0, Math.floor(offset))) as Array<{ session_key: string }>;
  return rows.map((row) => row.session_key);
}

export function bindSessionsToProject(sessionKeys: string[], projectId: string): void {
  assertProjectExists(projectId);
  runSqliteWriteTransaction((db) => {
    const now = Date.now();
    const stmt = db.prepare(`UPDATE sessions SET project_id = ?, updated_at = ? WHERE session_key = ?`);
    for (const key of sessionKeys) {
      stmt.run(projectId, now, key);
    }
    db.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}

export function moveSessionToProject(sessionKey: string, targetProjectId: string): void {
  bindSessionToProject(sessionKey, targetProjectId);
}
