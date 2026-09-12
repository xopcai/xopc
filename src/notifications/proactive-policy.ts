import type { ProductNotification } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { digestCards } from '../proactive/inbox/digest.js';
import { recheckProactiveNotification } from '../proactive/inbox/notification-policy.js';
import { proactivePreferences, quietHoursEnd } from '../proactive/policy/service.js';
import { viewingProactiveCards } from '../proactive/policy/presence.js';

export function proactiveNotificationWorkspace(notification: Pick<ProductNotification, 'target'>): string | null {
  const target = notification.target;
  const db = getSqliteDatabase();
  const row = target.kind === 'insight'
    ? db.prepare(`SELECT s.workspace_id FROM proactive_inbox_items i JOIN proactive_insights x USING(insight_id) JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE i.inbox_item_id = ?`).get(target.inboxItemId)
    : target.kind === 'proactive_digest' ? db.prepare('SELECT workspace_id FROM proactive_digests WHERE digest_id = ?').get(target.digestId) : null;
  return (row as { workspace_id: string } | null)?.workspace_id ?? null;
}
export function recheckNotificationDelivery(notification: ProductNotification, channel: 'browser' | 'mobile' | 'telegram', now = new Date()): 'send' | 'cancel' | Date {
  if (notification.type !== 'proactive.insight') return 'send';
  const workspace = proactiveNotificationWorkspace(notification);
  if (!workspace) return 'cancel';
  const preferences = proactivePreferences(workspace);
  if (!['all', 'auto', channel].includes(preferences.preferredChannel)) return 'cancel';
  if (preferences.level === 'off' || (preferences.pausedUntil && Date.parse(preferences.pausedUntil) > now.getTime())) return 'cancel';
  if (preferences.suppressWhileViewing && viewingProactiveCards(workspace, now.getTime())) return 'cancel';
  if (notification.target.kind === 'insight') return recheckProactiveNotification(notification.target.inboxItemId, now, notification.payload.notificationRevision);
  if (notification.target.kind === 'proactive_digest') {
    if (!digestCards(notification.target.digestId, workspace).length) return 'cancel';
    return quietHoursEnd(preferences, now) ?? 'send';
  }
  return 'cancel';
}
