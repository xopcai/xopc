import { proactiveNotificationWorkspace, recheckNotificationDelivery } from './proactive-policy.js';
import { proactivePreferences } from '../proactive/policy/service.js';
import { flushDueDigests } from '../proactive/inbox/digest.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { drainChannelNotifications, enqueueChannelNotification, type ProactiveChannelSender } from './proactive-channel.js';
import { drainBrowserPush, enqueueBrowserPush } from './web-push.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { localizeNotification, type ProductNotificationType } from '@xopcai/gateway-contract';

import { createLogger } from '../utils/logger.js';

import {
  disableNotificationDeviceForPushToken,
  listDeliverableNotificationDevices,
} from './device-store.js';
import { notificationPlanFromGatewayEvent, type NotificationPlan } from './planner.js';
import {
  createNotificationEvent,
  deferNotificationDelivery,
  expireUndeliverableNotificationDeliveries,
  listDueNotificationDeliveries,
  markNotificationDeliveryAccepted,
  markNotificationDeliveryDead,
  markNotificationDeliveryDelivered,
  pruneNotificationEvents,
  rescheduleNotificationDelivery,
  type NotificationDelivery,
} from './store.js';
import type { NotificationPreferences } from './types.js';

const log = createLogger('Notifications');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
const RECEIPT_DELAY_MS = 15 * 60_000;

type ExpoResult = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

function preferenceAllows(type: ProductNotificationType, preferences: NotificationPreferences): boolean {
  switch (type) {
    case 'chat.completed': return preferences.chatCompleted;
    case 'chat.failed': return preferences.chatFailed;
    case 'task.needs_input': return preferences.taskNeedsInput;
    case 'task.blocked': return preferences.taskBlocked;
    case 'task.failed': return preferences.taskFailed;
    case 'task.completed': return preferences.taskCompleted;
    case 'automation.completed': return preferences.automationCompleted;
    case 'automation.failed': return preferences.automationFailed;
    case 'proactive.insight': return preferences.proactiveInsight;
    case 'work_discovery.review_ready':
    case 'work_discovery.failed':
      return true;
  }
}

function retryAt(attempts: number, now: number): number {
  return now + RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)]!;
}

function expoError(result: ExpoResult): string {
  return result.details?.error || result.message || 'Expo rejected the notification';
}

export class NotificationService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private lastMaintenanceAt = 0;

  constructor(private readonly options: {
    publish: (type: string, payload: unknown) => void;
    fetch?: typeof fetch;
    sendChannel?: ProactiveChannelSender;
  }) {}

  start(): void {
    if (this.timer) return;
    void this.drain();
    this.timer = setInterval(() => void this.drain(), 30_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  handleGatewayEvent(type: string, payload: unknown): void {
    try {
      const notification = this.persistGatewayEvent(type, payload);
      if (!notification) return;
      this.options.publish('notification.created', notification);
      void this.drain();
    } catch (err) {
      log.error({ err, eventType: type }, 'Notification event persistence failed');
    }
  }

  /** Throws on persistence failure so durable producers can retry the handoff. */
  persistGatewayEvent(type: string, payload: unknown) {
    const plan = notificationPlanFromGatewayEvent(type, payload);
    if (!plan) return null;
    return this.persistPlan(plan);
  }

  persistPlan(plan: NotificationPlan) {
    let devices = listDeliverableNotificationDevices()
      .filter((device) => preferenceAllows(plan.notification.type, device.preferences));
    const workspace = proactiveNotificationWorkspace(plan.notification);
    let browserIds: string[] | undefined;
    let selectedChannel = 'all';
    if (workspace) {
      const preferences = proactivePreferences(workspace);
      const browsers = getSqliteDatabase().prepare('SELECT id FROM proactive_web_push_subscriptions WHERE workspace_id = ? ORDER BY created_at DESC, id').all(workspace) as Array<{ id: string }>;
      selectedChannel = preferences.preferredChannel === 'auto' ? (browsers.length ? 'browser' : devices.length ? 'mobile' : 'browser') : preferences.preferredChannel;
      if (!['all', 'mobile'].includes(selectedChannel)) devices = [];
      else if (preferences.preferredChannel === 'auto') devices = devices.slice(0, 1);
      browserIds = ['all', 'browser'].includes(selectedChannel) ? browsers.map((row) => row.id) : [];
      if (preferences.preferredChannel === 'auto') browserIds = browserIds.slice(0, 1);
      plan = { ...plan, notification: { ...plan.notification, payload: { ...plan.notification.payload, deliveryChannel: selectedChannel, deliveryMode: preferences.preferredChannel } } };
    }
    const result = runSqliteWriteTransaction(() => {
      const created = createNotificationEvent({ ...plan, deviceIds: devices.map((device) => device.id) });
      if (created.created) {
        enqueueBrowserPush(created.notification, browserIds);
        if (workspace && selectedChannel === 'telegram') enqueueChannelNotification(created.notification, workspace);
      }
      return created;
    });
    return result.created ? result.notification : null;
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const now = Date.now();
      if (now - this.lastMaintenanceAt >= 60 * 60 * 1_000) {
        expireUndeliverableNotificationDeliveries(now);
        pruneNotificationEvents(now - 30 * 24 * 60 * 60 * 1_000);
        this.lastMaintenanceAt = now;
      }
      for (const notification of flushDueDigests((plan) => this.persistPlan(plan))) this.options.publish('notification.created', notification);
      await this.deliverPending();
      await this.checkReceipts();
      await drainBrowserPush();
      if (this.options.sendChannel) await drainChannelNotifications(this.options.sendChannel);
    } catch (err) {
      log.warn({ err }, 'Notification delivery pass failed');
    } finally {
      this.draining = false;
    }
  }

  private async deliverPending(): Promise<void> {
    const deliveries = listDueNotificationDeliveries('pending');
    await Promise.all(deliveries.map((delivery) => this.send(delivery)));
  }

  private async send(delivery: NotificationDelivery): Promise<void> {
    if (delivery.event.type === 'proactive.insight') {
      const policy = recheckNotificationDelivery(delivery.event, 'mobile');
      if (policy === 'cancel') { markNotificationDeliveryDead(delivery.event.id, delivery.deviceId, 'Proactive policy changed'); return; }
      if (policy instanceof Date) { deferNotificationDelivery(delivery.event.id, delivery.deviceId, policy.getTime()); return; }
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const localized = localizeNotification(delivery.event, delivery.locale);
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          to: delivery.pushToken,
          title: delivery.event.type === 'proactive.insight' ? (delivery.locale.startsWith('zh') ? '有一项工作需要查看' : 'A work update is ready') : localized.localizedTitle,
          body: delivery.event.type === 'proactive.insight' ? (delivery.locale.startsWith('zh') ? '打开 xopc 查看详情。' : 'Open xopc to review it.') : localized.localizedBody,
          sound: delivery.event.priority === 'high' ? 'default' : undefined,
          priority: delivery.event.priority,
          data: {
            eventId: delivery.event.id,
            target: delivery.event.target,
            ...delivery.event.payload,
          },
        }),
      });
      if (!response.ok) throw new Error(`Expo push request failed (${response.status})`);
      const body = await response.json() as { data?: ExpoResult | ExpoResult[] };
      const result = Array.isArray(body.data) ? body.data[0] : body.data;
      if (result?.status !== 'ok' || !result.id) {
        const error = expoError(result ?? {});
        if (result?.details?.error === 'DeviceNotRegistered') {
          disableNotificationDeviceForPushToken(delivery.pushToken);
          markNotificationDeliveryDead(delivery.event.id, delivery.deviceId, error);
          return;
        }
        throw new Error(error);
      }
      markNotificationDeliveryAccepted(
        delivery.event.id,
        delivery.deviceId,
        result.id,
        Date.now() + RECEIPT_DELAY_MS,
      );
    } catch (err) {
      this.retryOrFail(delivery, err);
    }
  }

  private async checkReceipts(): Promise<void> {
    const deliveries = listDueNotificationDeliveries('accepted');
    const withTickets = deliveries.filter((delivery) => delivery.providerTicketId);
    if (withTickets.length === 0) return;
    const fetchImpl = this.options.fetch ?? fetch;
    try {
      const response = await fetchImpl(EXPO_RECEIPTS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ ids: withTickets.map((delivery) => delivery.providerTicketId) }),
      });
      if (!response.ok) throw new Error(`Expo receipt request failed (${response.status})`);
      const body = await response.json() as { data?: Record<string, ExpoResult> };
      for (const delivery of withTickets) {
        const result = body.data?.[delivery.providerTicketId!];
        if (!result) {
          this.retryOrFail(delivery, new Error('Expo receipt is not ready'), 'accepted');
        } else if (result.status === 'ok') {
          markNotificationDeliveryDelivered(delivery.event.id, delivery.deviceId);
        } else {
          const error = expoError(result);
          if (result.details?.error === 'DeviceNotRegistered') {
            disableNotificationDeviceForPushToken(delivery.pushToken);
          }
          markNotificationDeliveryDead(delivery.event.id, delivery.deviceId, error);
        }
      }
    } catch (err) {
      for (const delivery of withTickets) this.retryOrFail(delivery, err, 'accepted');
    }
  }

  private retryOrFail(
    delivery: NotificationDelivery,
    error: unknown,
    status: 'pending' | 'accepted' = 'pending',
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    if (delivery.attempts + 1 >= MAX_DELIVERY_ATTEMPTS) {
      markNotificationDeliveryDead(delivery.event.id, delivery.deviceId, message);
      log.warn(
        { eventId: delivery.event.id, deviceId: delivery.deviceId, errorMessage: message },
        `Notification delivery exhausted retries: ${message}`,
      );
      return;
    }
    rescheduleNotificationDelivery(
      delivery.event.id,
      delivery.deviceId,
      status,
      retryAt(delivery.attempts, Date.now()),
      message,
    );
  }
}
