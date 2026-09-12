import { z } from 'zod';

import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

const PresenceSchema = z.object({ clientId: z.string().min(8).max(128), active: z.boolean(), surface: z.enum(['web', 'electron', 'mobile']) }).strict();
export function recordProactivePresence(workspaceId: string, value: unknown, now = Date.now()): void {
  const input = PresenceSchema.parse(value);
  const db = getSqliteDatabase();
  db.prepare('DELETE FROM proactive_presence WHERE expires_at <= ?').run(now);
  if (!input.active) { db.prepare('DELETE FROM proactive_presence WHERE workspace_id = ? AND client_id = ?').run(workspaceId, input.clientId); return; }
  db.prepare(`INSERT INTO proactive_presence VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, client_id) DO UPDATE SET surface = excluded.surface, expires_at = excluded.expires_at`)
    .run(workspaceId, input.clientId, input.surface, now + 75000);
}
export function viewingProactiveCards(workspaceId: string, now = Date.now()): boolean {
  return Boolean(getSqliteDatabase().prepare('SELECT 1 FROM proactive_presence WHERE workspace_id = ? AND expires_at > ?').get(workspaceId, now));
}
