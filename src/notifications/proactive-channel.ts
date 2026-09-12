import { notificationTargetRoute } from '@xopcai/gateway-contract';
import type { ProductNotification, ProactivePreferences } from '@xopcai/gateway-contract';

import { proactivePreferences } from '../proactive/policy/service.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { recheckNotificationDelivery } from './proactive-policy.js';
import { getNotificationEvent } from './store.js';

type Target = NonNullable<ProactivePreferences['telegram']>;
export type ProactiveChannelSender = (target: Target, text: string) => Promise<{ messageId: string }>;

export function enqueueChannelNotification(notification: ProductNotification, workspace: string): void {
  const target = proactivePreferences(workspace).telegram;
  if (!target) throw new Error('Configure a Telegram destination before selecting it');
  getSqliteDatabase().prepare('INSERT OR IGNORE INTO proactive_channel_deliveries(notification_id, workspace_id, target_json, next_attempt_at) VALUES (?, ?, ?, ?)')
    .run(notification.id, workspace, JSON.stringify(target), Date.now());
}

export async function drainChannelNotifications(send: ProactiveChannelSender): Promise<void> {
  const db = getSqliteDatabase();
  const claim = runSqliteWriteTransaction((tx) => {
    tx.prepare("UPDATE proactive_channel_deliveries SET status = 'failed', last_error = 'Lease exhausted' WHERE status = 'sending' AND lease_until <= ? AND attempt >= 5").run(Date.now());
    const row = tx.prepare(`SELECT * FROM proactive_channel_deliveries WHERE (status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until <= ?) ORDER BY next_attempt_at LIMIT 1`).get(Date.now(), Date.now()) as
      { notification_id: string; workspace_id: string; target_json: string; attempt: number } | undefined;
    if (!row) return null;
    tx.prepare("UPDATE proactive_channel_deliveries SET status = 'sending', attempt = attempt + 1, lease_until = ? WHERE notification_id = ?").run(Date.now() + 120000, row.notification_id);
    return { ...row, attempt: row.attempt + 1 };
  });
  if (!claim) return;
  const finish = (status: string, nextAt: number, messageId: string | null = null, error: string | null = null) => {
    db.prepare(`UPDATE proactive_channel_deliveries SET status = ?, next_attempt_at = ?, provider_message_id = ?, last_error = ?, lease_until = NULL
      WHERE notification_id = ? AND status = 'sending' AND attempt = ?`).run(status, nextAt, messageId, error, claim.notification_id, claim.attempt);
  };
  try {
    const notification = getNotificationEvent(claim.notification_id);
    const current = proactivePreferences(claim.workspace_id);
    if (!notification || current.preferredChannel !== 'telegram' || JSON.stringify(current.telegram) !== claim.target_json) { finish('cancelled', Date.now()); return; }
    const policy = recheckNotificationDelivery(notification, 'telegram');
    if (policy === 'cancel') { finish('cancelled', Date.now()); return; }
    if (policy instanceof Date) {
      finish('pending', policy.getTime());
      db.prepare('UPDATE proactive_channel_deliveries SET attempt = attempt - 1 WHERE notification_id = ? AND attempt = ?').run(claim.notification_id, claim.attempt);
      return;
    }
    const target = JSON.parse(claim.target_json) as Target;
    const url = new URL(target.publicUrl);
    url.hash = notificationTargetRoute(notification.target, 'web');
    const text = `${notification.target.kind === 'proactive_digest' ? '你的工作摘要已就绪 / Your work digest is ready.' : '有一项工作需要查看 / A work update is ready.'}\n${url.toString()}`;
    const result = await send(target, text);
    if (!result.messageId) throw new Error('No delivery receipt');
    finish('sent', Date.now(), result.messageId);
  } catch {
    finish(claim.attempt >= 5 ? 'failed' : 'pending', Date.now() + Math.min(3600000, 30000 * 2 ** claim.attempt), null, 'Telegram delivery failed');
  }
}
