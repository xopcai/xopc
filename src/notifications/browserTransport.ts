import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import webPush from 'web-push';

import { allowedPushEndpoint } from './browser-endpoint.js';
import type { DispatchReceipt, NotificationDispatch } from './dispatch.js';

/** Browser transport over the canonical ledger. Route resolution remains an authenticated host concern. */
export function createBrowserNotificationTransport(db: DatabaseSync, options: {
  route: (dispatch: NotificationDispatch) => string | null;
  send?: typeof webPush.sendNotification;
  clock?: () => number;
}) {
  return async (dispatch: NotificationDispatch, signal: AbortSignal): Promise<DispatchReceipt> => {
    const now = (options.clock ?? Date.now)();
    if (dispatch.channel !== 'browser' || signal.aborted) return { status: 'rejected' };
    const subscription = db.prepare(`SELECT * FROM notification_browser_subscriptions
      WHERE id = ? AND owner_id = ? AND workspace_id = ? AND (expires_at IS NULL OR expires_at > ?)`)
      .get(dispatch.destinationId, dispatch.ownerId, dispatch.workspaceId, now);
    const keys = db.prepare('SELECT public_key, private_key FROM notification_browser_keys WHERE id = 1').get();
    if (!subscription || !keys || !allowedPushEndpoint(String(subscription.endpoint))) return { status: 'rejected' };
    const route = options.route(dispatch);
    // Only same-origin app paths. Never place an external or script URL in a push payload.
    if (!route || !route.startsWith('/') || route.startsWith('//') || /[\\\s]/u.test(route)
      || new URL(route, 'https://xopc.invalid').origin !== 'https://xopc.invalid') return { status: 'rejected' };
    const zh = subscription.language === 'zh';
    const payload = JSON.stringify({ id: dispatch.notificationId, title: zh ? '有新成果需要查看' : 'An update is ready',
      body: zh ? '打开 xopc 查看详情。' : 'Open xopc to review it.', route });
    try {
      await (options.send ?? webPush.sendNotification)({ endpoint: String(subscription.endpoint),
        expirationTime: subscription.expires_at === null ? null : Number(subscription.expires_at),
        keys: { auth: String(subscription.auth_key), p256dh: String(subscription.public_key) } }, payload, {
        vapidDetails: { subject: 'https://xopc.ai', publicKey: String(keys.public_key), privateKey: String(keys.private_key) },
        TTL: 3600, timeout: 10_000, topic: createHash('sha256').update(dispatch.id).digest('base64url').slice(0, 32),
      });
      return { status: 'accepted', providerMessageId: null };
    } catch (error) {
      const status = (error as { statusCode?: number } | null)?.statusCode;
      if (status === 429) return { status: 'rejected', retryAt: (options.clock ?? Date.now)() + 30_000 };
      if (status !== undefined && [400, 401, 403, 404, 410, 413].includes(status)) return { status: 'rejected' };
      // Transport timeouts and ambiguous server failures must become unknown, not automatic retries.
      throw new Error('Browser transport result is unconfirmed');
    }
  };
}
