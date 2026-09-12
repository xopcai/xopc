import { createHash } from 'node:crypto';

import { effectiveProactivePolicy, localProactiveDay, quietHoursEnd } from '../policy/service.js';
import { viewingProactiveCards } from '../policy/presence.js';
import { nextDigestTime, queueDigest } from './digest.js';
import { insightCorrelation } from './lifecycle.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { insightSourcesAuthorized } from '../execution/authorization.js';
import type { NotificationService } from '../../notifications/service.js';
import { notificationPlanFromGatewayEvent } from '../../notifications/planner.js';
import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { reserveProactiveNotification } from '../policy/service.js';
import { getInboxItem } from './repository.js';
import type { InboxItem } from './types.js';

/** The outbox is acknowledged only after a notification or suppression is persisted. */
export function deliverProactiveCard(item: InboxItem, notifications: NotificationService, publish: (type: string, payload: unknown) => void): void | { retryAt: string } {
  const result = runSqliteWriteTransaction(() => {
    const current = getInboxItem(item.id);
    if (!current || current.withdrawnAt || !insightSourcesAuthorized(current.insightId) || current.status === 'resolved' || (current.expiresAt && Date.parse(current.expiresAt) <= Date.now())) return null;
    if (current.status === 'snoozed') return { retryAt: current.snoozedUntil! };
    const policy = effectiveProactivePolicy(current.subscriptionId!);
    if (!policy.enabled || policy.settings.delivery === 'inbox') return null;
    if ((policy.preferences.digestEnabled || policy.settings.delivery === 'digest') && current.insight.attentionKind !== 'receipt') {
      queueDigest(current, 'daily', nextDigestTime(policy.preferences, new Date()));
      return null;
    }
    const plan = notificationPlanFromGatewayEvent('proactive.inbox.created', current);
    if (!plan) return null;
    if (policy.level === 'quiet') return null;
    const quietUntil = quietHoursEnd(policy.preferences, new Date());
    if (quietUntil) { queueDigest(current, 'quiet', quietUntil); return null; }
    const db = getSqliteDatabase();
    const correlation = insightCorrelation(current.insightId);
    const reason = createHash('sha256').update(JSON.stringify([current.insight.urgency, current.insight.decision ?? null])).digest('hex');
    const key = `proactive:${correlation}:${reason}:${localProactiveDay(new Date(), policy.preferences.timezone)}`;
    if (db.prepare('SELECT 1 FROM proactive_delivery_decisions WHERE notification_key = ?').get(key)) return null;
    const visible = policy.preferences.suppressWhileViewing && viewingProactiveCards(policy.workspaceId);
    if (visible) { db.prepare('INSERT INTO proactive_delivery_decisions VALUES (?, ?, ?, ?)').run(key, policy.workspaceId, 'visible_in_app', new Date().toISOString()); return null; }
    const decision = reserveProactiveNotification(current.subscriptionId!, key);
    if (decision instanceof Date) return { retryAt: decision.toISOString() };
    if (decision === 'suppressed') return null;
    const result = notifications.persistGatewayEvent('proactive.inbox.created', current);
    db.prepare('INSERT INTO proactive_delivery_decisions VALUES (?, ?, ?, ?)').run(key, policy.workspaceId, 'immediate', new Date().toISOString());
    return result;
  });
  publish('proactive.card.changed', { cardId: item.id, revision: item.revision });
  if (result && 'retryAt' in result) return result;
  if (result) publish('notification.created', result);
}
