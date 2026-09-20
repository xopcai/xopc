import type { NotificationDomainDelivery } from '../../notifications/domain-delivery.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { flushDueDigests } from '../inbox/digest.js';
import { proactivePreferences } from '../policy/service.js';

import { drainBrowserPush, enqueueBrowserPush } from './browser.js';
import { drainChannelNotifications, enqueueChannelNotification, type ProactiveChannelSender } from './channel.js';
import { proactivePlan } from './planner.js';
import { proactiveNotificationWorkspace, recheckNotificationDelivery } from './policy.js';

/** All delivery rules and storage for the Proactive domain have a single owner. */
export function createProactiveNotificationDelivery(sendChannel?: ProactiveChannelSender): NotificationDomainDelivery {
  return {
    owns: (type) => type === 'proactive.insight',
    allowsDevice: (preferences) => preferences.proactiveInsight,
    planEvent: (type, payload) => type === 'proactive.inbox.created' ? proactivePlan(payload) : null,
    prepare(plan, devices) {
      const workspace = proactiveNotificationWorkspace(plan.notification);
      if (!workspace) throw new Error('Notification has no authorized workspace');
      const preferences = proactivePreferences(workspace);
      const browsers = getSqliteDatabase().prepare('SELECT id FROM proactive_web_push_subscriptions WHERE workspace_id = ? ORDER BY created_at DESC, id')
        .all(workspace) as Array<{ id: string }>;
      const selectedChannel = preferences.preferredChannel === 'auto'
        ? (browsers.length ? 'browser' : devices.length ? 'mobile' : 'browser') : preferences.preferredChannel;
      if (!['all', 'mobile'].includes(selectedChannel)) devices = [];
      else if (preferences.preferredChannel === 'auto') devices = devices.slice(0, 1);
      let browserIds = ['all', 'browser'].includes(selectedChannel) ? browsers.map((row) => row.id) : [];
      if (preferences.preferredChannel === 'auto') browserIds = browserIds.slice(0, 1);
      return {
        plan: { ...plan, notification: { ...plan.notification, payload: {
          ...plan.notification.payload, deliveryChannel: selectedChannel, deliveryMode: preferences.preferredChannel,
        } } },
        deviceIds: devices.map((device) => device.id),
        enqueue(notification) {
          enqueueBrowserPush(notification, browserIds);
          if (selectedChannel === 'telegram') enqueueChannelNotification(notification, workspace);
        },
      };
    },
    flush: flushDueDigests,
    async drain() {
      await drainBrowserPush();
      if (sendChannel) await drainChannelNotifications(sendChannel);
    },
    recheckMobile: (notification) => recheckNotificationDelivery(notification, 'mobile'),
    mobilePreview: (_notification, locale) => ({
      title: locale.startsWith('zh') ? '有一项工作需要查看' : 'A work update is ready',
      body: locale.startsWith('zh') ? '打开 xopc 查看详情。' : 'Open xopc to review it.',
    }),
  };
}
