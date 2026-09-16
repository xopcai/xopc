import { effectiveProactivePolicy, quietHoursEnd } from '../policy/service.js';
import { insightSourcesAuthorized, insightSourcesChanged, insightSourcesFresh } from '../execution/authorization.js';
import { getInboxItem } from './repository.js';

export function recheckProactiveNotification(itemId: string, now = new Date(), notificationRevision?: unknown, forDigest = false): 'send' | 'cancel' | Date {
  const item = getInboxItem(itemId);
  if (!item || item.withdrawnAt || !insightSourcesAuthorized(item.insightId) || ['resolved', 'read'].includes(item.status) || (item.expiresAt && Date.parse(item.expiresAt) <= now.getTime())) return 'cancel';
  if (item.insight.actionStatus !== 'completed' && insightSourcesChanged(item.insightId)) return 'cancel';
  if (item.actionableUntil && Date.parse(item.actionableUntil) <= now.getTime()) return 'cancel';
  if (!insightSourcesFresh(item.insightId)) return new Date(now.getTime() + 60000);
  if (typeof notificationRevision === 'number' && notificationRevision !== item.notificationRevision) return 'cancel';
  const policy = effectiveProactivePolicy(item.subscriptionId!, now);
  if (!policy.enabled || policy.preferences.notificationsMuted || policy.settings.delivery === 'inbox') return 'cancel';
  if (!forDigest && policy.preferences.digestEnabled && item.insight.attentionKind !== 'receipt') return 'cancel';
  if (!forDigest && policy.level !== 'active' && ['low', 'medium'].includes(item.insight.urgency) && !item.insight.decision) return 'cancel';
  if (item.status === 'snoozed') return new Date(item.snoozedUntil!);
  {
    if (!forDigest && (policy.level === 'quiet' || policy.settings.delivery !== 'important')) return 'cancel';
    const until = quietHoursEnd(policy.preferences, now);
    if (until) return until;
  }
  return 'send';
}
