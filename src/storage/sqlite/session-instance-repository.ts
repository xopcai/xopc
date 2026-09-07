import type { DatabaseSync } from 'node:sqlite';

export function readCurrentSessionId(db: DatabaseSync, sessionKey: string): string | null {
  const row = db
    .prepare(`SELECT session_id FROM sessions WHERE session_key = ?`)
    .get(sessionKey) as { session_id?: string } | undefined;
  return row?.session_id ?? null;
}
