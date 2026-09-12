import { effectiveProactivePolicy, quietHoursEnd } from '../policy/service.js';
import { insightSourcesAuthorized } from '../execution/authorization.js';
import { getInboxItem } from './repository.js';

export function recheckProactiveNotification(itemId: string, now = new Date(), notificationRevision?: unknown): 'send' | 'cancel' | Date {
  const item = getInboxItem(itemId);
  if (!item || item.withdrawnAt || !insightSourcesAuthorized(item.insightId) || item.status === 'resolved' || (item.expiresAt && Date.parse(item.expiresAt) <= now.getTime())) return 'cancel';
  if (typeof notificationRevision === 'number' && notificationRevision !== item.notificationRevision) return 'cancel';
  const policy = effectiveProactivePolicy(item.subscriptionId!, now);
  if (!policy.enabled || (policy.preferences.digestEnabled && item.insight.attentionKind !== 'receipt')) return 'cancel';
  if (item.status === 'snoozed') return new Date(item.snoozedUntil!);
  if (policy.settings.managed || policy.preferences.revision > 0) {
    if (policy.level === 'quiet' || policy.settings.delivery !== 'important') return 'cancel';
    const until = quietHoursEnd(policy.preferences, now);
    if (until) return until;
  }
  return 'send';
}
