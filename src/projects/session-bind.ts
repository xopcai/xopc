import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

function projectExists(projectId: string): boolean {
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM projects WHERE project_id = ?`).get(projectId));
}

function assertProjectExists(projectId: string): void {
  if (!projectExists(projectId)) {
    throw new Error(`Project not found: ${projectId}`);
  }
}

function assertSessionExists(conversationId: string): void {
  const row = getSqliteDatabase().prepare(`SELECT 1 FROM sessions WHERE conversation_id = ?`).get(conversationId);
  if (!row) throw new Error(`Session not found: ${conversationId}`);
}

export function bindSessionToProject(conversationId: string, projectId: string): void {
  assertProjectExists(projectId);
  assertSessionExists(conversationId);
  runSqliteWriteTransaction((db) => {
    const now = Date.now();
    db.prepare(`UPDATE sessions SET project_id = ?, updated_at = ? WHERE conversation_id = ?`).run(projectId, now, conversationId);
    db.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}

export function unbindSessionFromProject(conversationId: string): void {
  assertSessionExists(conversationId);
  runSqliteWriteTransaction((db) => {
    db.prepare(`UPDATE sessions SET project_id = NULL, updated_at = ? WHERE conversation_id = ?`).run(Date.now(), conversationId);
  });
}

export function listProjectConversationIds(projectId: string, limit = 100, offset = 0): string[] {
  assertProjectExists(projectId);
  const rows = getSqliteDatabase()
    .prepare(`SELECT conversation_id FROM sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(projectId, Math.min(500, Math.max(1, Math.floor(limit))), Math.max(0, Math.floor(offset))) as Array<{ conversation_id: string }>;
  return rows.map((row) => row.conversation_id);
}

export function bindSessionsToProject(conversationIds: string[], projectId: string): void {
  assertProjectExists(projectId);
  runSqliteWriteTransaction((db) => {
    const now = Date.now();
    const stmt = db.prepare(`UPDATE sessions SET project_id = ?, updated_at = ? WHERE conversation_id = ?`);
    for (const key of conversationIds) {
      stmt.run(projectId, now, key);
    }
    db.prepare(`UPDATE projects SET last_active_at = ?, updated_at = ? WHERE project_id = ?`).run(now, now, projectId);
  });
}

export function moveSessionToProject(conversationId: string, targetProjectId: string): void {
  bindSessionToProject(conversationId, targetProjectId);
}
