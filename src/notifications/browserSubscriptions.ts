import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import webPush from 'web-push';
import { z } from 'zod';

import { allowedPushEndpoint } from './browser-endpoint.js';

type Owner = { ownerId: string; workspaceId: string };
const inputSchema = z.strictObject({ endpoint: z.string().max(4096).refine(allowedPushEndpoint),
  expirationTime: z.number().int().positive().nullable(), language: z.enum(['en', 'zh']),
  keys: z.strictObject({ auth: z.string().regex(/^[\w-]+$/).refine(value => Buffer.from(value, 'base64url').length === 16),
    p256dh: z.string().regex(/^[\w-]+$/).refine(value => Buffer.from(value, 'base64url').length === 65) }) });

/** User subscriptions share the same durable delivery ledger as every browser transport. */
export class BrowserSubscriptionService {
  constructor(private readonly db: DatabaseSync, private readonly clock = Date.now) {}

  prepare(): { publicKey: string } {
    let row = this.db.prepare('SELECT public_key FROM notification_browser_keys WHERE id = 1').get();
    if (!row) {
      const keys = webPush.generateVAPIDKeys();
      this.db.prepare('INSERT INTO notification_browser_keys VALUES (1, ?, ?)').run(keys.publicKey, keys.privateKey);
      row = { public_key: keys.publicKey };
    }
    return { publicKey: String(row.public_key) };
  }

  register(owner: Owner, value: unknown): { id: string } {
    const input = inputSchema.parse(value);
    const now = this.clock();
    if (input.expirationTime !== null && input.expirationTime <= now) throw new Error('Subscription expired');
    const id = createHash('sha256').update(input.endpoint).digest('hex');
    const existing = this.db.prepare('SELECT owner_id, workspace_id FROM notification_browser_subscriptions WHERE id = ?').get(id);
    if (existing && (existing.owner_id !== owner.ownerId || existing.workspace_id !== owner.workspaceId)) throw new Error('Subscription belongs to another workspace');
    this.db.prepare('DELETE FROM notification_browser_subscriptions WHERE expires_at <= ?').run(now);
    if (!existing && Number(this.db.prepare('SELECT COUNT(*) AS n FROM notification_browser_subscriptions WHERE owner_id = ? AND workspace_id = ?').get(owner.ownerId, owner.workspaceId)?.n) >= 20) throw new Error('Subscription limit reached');
    this.db.prepare(`INSERT INTO notification_browser_subscriptions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET auth_key = excluded.auth_key, public_key = excluded.public_key,
        expires_at = excluded.expires_at, language = excluded.language`)
      .run(id, owner.ownerId, owner.workspaceId, input.endpoint, input.keys.auth, input.keys.p256dh, input.expirationTime, input.language, now);
    return { id };
  }

  remove(owner: Owner, id: string): void {
    this.db.prepare('DELETE FROM notification_browser_subscriptions WHERE id = ? AND owner_id = ? AND workspace_id = ?')
      .run(id, owner.ownerId, owner.workspaceId);
    this.db.prepare("UPDATE notification_dispatches SET status = 'cancelled' WHERE owner_id = ? AND workspace_id = ? AND destination_id = ? AND status = 'pending'")
      .run(owner.ownerId, owner.workspaceId, id);
  }
}

export function enqueueBrowserDispatches(db: DatabaseSync, owner: Owner, notificationId: string, subjectId: string | null, revision: number, now: number): void {
  const subscriptions = db.prepare('SELECT id FROM notification_browser_subscriptions WHERE owner_id = ? AND workspace_id = ? AND (expires_at IS NULL OR expires_at > ?)')
    .all(owner.ownerId, owner.workspaceId, now);
  for (const subscription of subscriptions) {
    const id = createHash('sha256').update(`${notificationId}:${subscription.id}`).digest('hex');
    db.prepare(`INSERT OR IGNORE INTO notification_dispatches(id, notification_id, owner_id, workspace_id, channel, destination_id,
      subject_id, subject_revision, status, attempt, next_attempt_at)
      VALUES (?, ?, ?, ?, 'browser', ?, ?, ?, 'pending', 0, ?)`)
      .run(id, notificationId, owner.ownerId, owner.workspaceId, subscription.id, subjectId, revision, now);
  }
}
