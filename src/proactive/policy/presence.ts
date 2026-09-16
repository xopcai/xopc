import { z } from 'zod';

import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';

const PresenceSchema = z.object({ clientId: z.string().min(8).max(128), active: z.boolean(), surface: z.enum(['web', 'electron', 'mobile']), inboxItemId: z.string().min(1).max(128).optional(), notificationRevision: z.number().int().positive().optional() }).strict();
export function recordProactivePresence(workspaceId: string, value: unknown, now = Date.now()): void {
  const input = PresenceSchema.parse(value);
  const db = getSqliteDatabase();
  db.prepare('DELETE FROM proactive_presence WHERE expires_at <= ?').run(now);
  if (!input.active) { db.prepare('DELETE FROM proactive_presence WHERE workspace_id = ? AND client_id = ?').run(workspaceId, input.clientId); return; }
  db.prepare(`INSERT INTO proactive_presence(workspace_id, client_id, surface, expires_at, inbox_item_id, notification_revision) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, client_id) DO UPDATE SET surface = excluded.surface, expires_at = excluded.expires_at, inbox_item_id = excluded.inbox_item_id, notification_revision = excluded.notification_revision`)
    .run(workspaceId, input.clientId, input.surface, now + 75000, input.inboxItemId ?? null, input.notificationRevision ?? null);
}
export function viewingProactiveCard(workspaceId: string, itemId: string, revision: number, now = Date.now()): boolean {
  return Boolean(getSqliteDatabase().prepare('SELECT 1 FROM proactive_presence WHERE workspace_id = ? AND inbox_item_id = ? AND notification_revision = ? AND expires_at > ?').get(workspaceId, itemId, revision, now));
}
