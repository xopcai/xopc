import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type DesktopExecutionRow = { device_id: string; revision: number; grant_id: string; approval_id: string; grant_json: string; active: number };
export function desktopExecutionRow(db: DatabaseSync, deviceId: string): DesktopExecutionRow | undefined {
  return db.prepare('SELECT device_id,revision,grant_id,approval_id,grant_json,active FROM desktop_execution_grants WHERE device_id=?').get(deviceId) as DesktopExecutionRow | undefined;
}
export function recordDesktopExecutionEvent(db: DatabaseSync, row: DesktopExecutionRow, action: 'granted' | 'revoked', now: number): void {
  db.prepare('INSERT INTO desktop_execution_grant_events(event_id,device_id,revision,grant_id,approval_id,action,grant_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), row.device_id, row.revision, row.grant_id, row.approval_id, action, row.grant_json, now);
}
/** Called inside the existing device-scope transaction; never restores a revoked grant. */
export function revokeDesktopExecutionRow(db: DatabaseSync, deviceId: string, now = Date.now()): void {
  const row = desktopExecutionRow(db, deviceId);
  if (!row?.active) return;
  if (!Number.isSafeInteger(row.revision + 1)) throw new Error('DESKTOP_EXECUTION_REVISION_LIMIT');
  db.prepare('UPDATE desktop_execution_grants SET active=0,revision=?,updated_at=? WHERE device_id=?').run(row.revision + 1, now, deviceId);
  recordDesktopExecutionEvent(db, { ...row, revision: row.revision + 1, active: 0 }, 'revoked', now);
}
