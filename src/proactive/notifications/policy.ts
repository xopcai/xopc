import type { ProductNotification } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { digestCards } from '../inbox/digest.js';
import { recheckProactiveNotification } from '../inbox/notification-policy.js';
import { proactivePreferences, proactiveChecksAllowed, quietHoursEnd } from '../policy/service.js';
import { viewingProactiveCard } from '../policy/presence.js';

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
  if (!proactiveChecksAllowed(preferences, now) || preferences.notificationsMuted) return 'cancel';
  if (preferences.suppressWhileViewing && notification.target.kind === 'insight' && viewingProactiveCard(workspace, notification.target.inboxItemId, Number(notification.payload.notificationRevision ?? 1), now.getTime())) return new Date(now.getTime() + 60000);
  if (notification.target.kind === 'insight') return recheckProactiveNotification(notification.target.inboxItemId, now, notification.payload.notificationRevision);
  if (notification.target.kind === 'proactive_digest') {
    const decisions = digestCards(notification.target.digestId, workspace, true).map(card => recheckProactiveNotification(card.id, now, card.notificationRevision, true));
    if (!decisions.length || decisions.every(value => value === 'cancel')) return 'cancel';
    if (!decisions.includes('send')) return decisions.find(value => value instanceof Date) ?? 'cancel';
    return quietHoursEnd(preferences, now) ?? 'send';
  }
  return 'cancel';
}
