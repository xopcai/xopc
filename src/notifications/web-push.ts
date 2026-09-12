import { createHash, randomUUID } from 'node:crypto';

import { notificationTargetRoute, ProductNotificationSchema, type ProductNotification } from '@xopcai/gateway-contract';
import webPush from 'web-push';
import { z } from 'zod';

import { proactiveNotificationWorkspace, recheckNotificationDelivery } from './proactive-policy.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
        || host.endsWith('.push.services.mozilla.com') || host === 'web.push.apple.com'
        || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}
const BrowserPushSchema = z.object({
  subscription: z.object({
    endpoint: z.string().max(4096).refine(allowedPushEndpoint, 'Unsupported push service'),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/), p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/) }).strict(),
  }).strict(),
  language: z.enum(['en', 'zh']).default('en'),
}).strict();

export function prepareBrowserPush() {
  return runSqliteWriteTransaction((db) => {
    let keys = db.prepare('SELECT public_key, private_key FROM proactive_web_push_keys WHERE id = 1').get() as { public_key: string; private_key: string } | undefined;
    if (!keys) {
      const generated = webPush.generateVAPIDKeys();
      db.prepare('INSERT INTO proactive_web_push_keys(id, public_key, private_key) VALUES (1, ?, ?)').run(generated.publicKey, generated.privateKey);
      keys = { public_key: generated.publicKey, private_key: generated.privateKey };
    }
    return { publicKey: keys.public_key };
  });
}

export function registerBrowserPush(workspaceId: string, value: unknown) {
  const input = BrowserPushSchema.parse(value);
  return runSqliteWriteTransaction((db) => {
    const existing = db.prepare('SELECT id, workspace_id FROM proactive_web_push_subscriptions WHERE endpoint = ?').get(input.subscription.endpoint) as { id: string; workspace_id: string } | undefined;
    if (existing && existing.workspace_id !== workspaceId) throw new Error('Push subscription belongs to another workspace');
    const id = existing?.id ?? randomUUID();
    db.prepare(`INSERT INTO proactive_web_push_subscriptions(id, workspace_id, endpoint, subscription_json, language, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET subscription_json = excluded.subscription_json, language = excluded.language`)
      .run(id, workspaceId, input.subscription.endpoint, JSON.stringify(input.subscription), input.language, new Date().toISOString());
    return { id };
  });
}

export function unregisterBrowserPush(workspaceId: string, id: string): void {
  getSqliteDatabase().prepare('DELETE FROM proactive_web_push_subscriptions WHERE workspace_id = ? AND id = ?').run(workspaceId, id);
}

export function enqueueBrowserPush(notification: ProductNotification, selectedIds?: string[]): void {
  const workspace = proactiveNotificationWorkspace(notification);
  if (!workspace) return;
  const targetId = notification.target.kind === 'insight' ? notification.target.inboxItemId : '';
  const subscriptions = getSqliteDatabase().prepare('SELECT id FROM proactive_web_push_subscriptions WHERE workspace_id = ?').all(workspace) as Array<{ id: string }>;
  for (const subscription of subscriptions) {
    if (selectedIds && !selectedIds.includes(subscription.id)) continue;
    getSqliteDatabase().prepare(`INSERT OR IGNORE INTO proactive_web_push_deliveries(notification_id, subscription_id, inbox_item_id, notification_revision, next_attempt_at) VALUES (?, ?, ?, ?, ?)`)
      .run(notification.id, subscription.id, targetId, typeof notification.payload.notificationRevision === 'number' ? notification.payload.notificationRevision : 1, Date.now());
  }
}

type PushClaim = { notification_id: string; subscription_id: string; inbox_item_id: string; notification_revision: number; subscription_json: string; language: string; attempt: number };

export async function drainBrowserPush(send: typeof webPush.sendNotification = webPush.sendNotification): Promise<void> {
  const db = getSqliteDatabase();
  const keys = db.prepare('SELECT public_key, private_key FROM proactive_web_push_keys WHERE id = 1').get() as { public_key: string; private_key: string } | undefined;
  if (!keys) return;
  const claim = runSqliteWriteTransaction((tx) => {
    tx.prepare("UPDATE proactive_web_push_deliveries SET status = 'failed', last_error = 'Delivery lease exhausted' WHERE status = 'sending' AND lease_until <= ? AND attempt >= 5").run(Date.now());
    const row = tx.prepare(`SELECT d.*, s.subscription_json, s.language FROM proactive_web_push_deliveries d
      JOIN proactive_web_push_subscriptions s ON s.id = d.subscription_id
      WHERE (d.status = 'pending' AND d.next_attempt_at <= ?) OR (d.status = 'sending' AND d.lease_until <= ?)
      ORDER BY d.next_attempt_at LIMIT 1`).get(Date.now(), Date.now()) as PushClaim | undefined;
    if (!row) return null;
    tx.prepare("UPDATE proactive_web_push_deliveries SET status = 'sending', attempt = attempt + 1, lease_until = ? WHERE notification_id = ? AND subscription_id = ?")
      .run(Date.now() + 60000, row.notification_id, row.subscription_id);
    return { ...row, attempt: row.attempt + 1 };
  });
  if (!claim) return;
  const finish = (status: string, nextAt: number, error: string | null = null) => db.prepare(`UPDATE proactive_web_push_deliveries SET status = ?, next_attempt_at = ?, last_error = ?, lease_until = NULL
    WHERE notification_id = ? AND subscription_id = ? AND attempt = ? AND status = 'sending'`).run(status, nextAt, error, claim.notification_id, claim.subscription_id, claim.attempt);
  try {
    const row = db.prepare('SELECT * FROM notification_events WHERE event_id = ?').get(claim.notification_id) as Record<string, unknown>;
    const notification = ProductNotificationSchema.parse({ schemaVersion: 1, id: row.event_id, type: row.event_type, target: JSON.parse(String(row.target_json)), priority: row.priority, title: { en: row.title_en, zh: row.title_zh }, payload: JSON.parse(String(row.payload_json)), createdAt: row.created_at });
    const policy = recheckNotificationDelivery(notification, 'browser');
    if (policy === 'cancel') { finish('failed', Date.now(), 'Policy changed or card expired'); return; }
    if (policy instanceof Date) {
      finish('pending', policy.getTime());
      db.prepare('UPDATE proactive_web_push_deliveries SET attempt = attempt - 1 WHERE notification_id = ? AND subscription_id = ? AND attempt = ?').run(claim.notification_id, claim.subscription_id, claim.attempt);
      return;
    }
    const subscription = JSON.parse(claim.subscription_json) as webPush.PushSubscription;
    if (!allowedPushEndpoint(subscription.endpoint)) throw new Error('Unsupported push service');
    await send(subscription, JSON.stringify({
      id: claim.notification_id,
      title: claim.language === 'zh' ? '有一项工作需要查看' : 'A work update is ready',
      body: claim.language === 'zh' ? '打开 xopc 查看详情。' : 'Open xopc to review it.',
      route: notificationTargetRoute(notification.target, 'web'),
    }), { vapidDetails: { subject: 'https://xopc.ai', publicKey: keys.public_key, privateKey: keys.private_key },
      TTL: 3600, timeout: 10000, topic: createHash('sha256').update(claim.inbox_item_id || claim.notification_id).digest('base64url').slice(0, 32) });
    finish('sent', Date.now());
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      db.prepare('DELETE FROM proactive_web_push_subscriptions WHERE id = ?').run(claim.subscription_id);
      return;
    }
    finish(claim.attempt >= 5 ? 'failed' : 'pending', Date.now() + Math.min(3600000, 30000 * 2 ** claim.attempt), status ? `Push service HTTP ${status}` : 'Push delivery failed');
  }
}

/** A user-triggered probe to this browser only; provider acceptance is not user delivery. */
export async function testBrowserPush(workspaceId: string, subscriptionId: string, send: typeof webPush.sendNotification = webPush.sendNotification) {
  const id = randomUUID();
  const claimed = runSqliteWriteTransaction((db) => {
    const row = db.prepare('SELECT subscription_json FROM proactive_web_push_subscriptions WHERE id = ? AND workspace_id = ?').get(subscriptionId, workspaceId) as { subscription_json: string } | undefined;
    if (!row) throw new Error('Browser subscription not found');
    if (db.prepare('SELECT 1 FROM proactive_push_probes WHERE workspace_id = ? AND created_at > ?').get(workspaceId, Date.now() - 60000)) throw new Error('Wait one minute before another push test');
    db.prepare('INSERT INTO proactive_push_probes(id, workspace_id, subscription_id, status, created_at) VALUES (?, ?, ?, ?, ?)').run(id, workspaceId, subscriptionId, 'sending', Date.now());
    return JSON.parse(row.subscription_json) as webPush.PushSubscription;
  });
  const keys = getSqliteDatabase().prepare('SELECT public_key, private_key FROM proactive_web_push_keys WHERE id = 1').get() as { public_key: string; private_key: string };
  try {
    if (!allowedPushEndpoint(claimed.endpoint)) throw new Error('Unsupported push service');
    await send(claimed, JSON.stringify({ id, title: 'xopc 推送测试 / Push test', body: '点击此通知确认打开 / Tap to confirm opening', route: `/proactive?probe=${encodeURIComponent(id)}` }), { vapidDetails: { subject: 'https://xopc.ai', publicKey: keys.public_key, privateKey: keys.private_key }, TTL: 300, timeout: 10000 });
    getSqliteDatabase().prepare("UPDATE proactive_push_probes SET status = CASE WHEN opened_at IS NULL THEN 'accepted' ELSE 'opened' END WHERE id = ?").run(id);
    return { id, status: 'accepted' };
  } catch {
    getSqliteDatabase().prepare("UPDATE proactive_push_probes SET status = 'failed', error = 'Push service did not accept the test' WHERE id = ?").run(id);
    throw new Error('Push test failed; verify browser subscription and network connectivity');
  }
}
export function acknowledgeBrowserProbe(workspaceId: string, id: string): void {
  getSqliteDatabase().prepare("UPDATE proactive_push_probes SET status = 'opened', opened_at = ? WHERE id = ? AND workspace_id = ?").run(Date.now(), id, workspaceId);
}
export function listBrowserProbes(workspaceId: string) {
  return getSqliteDatabase().prepare('SELECT id, status, created_at AS createdAt, opened_at AS openedAt, error FROM proactive_push_probes WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10').all(workspaceId);
}
