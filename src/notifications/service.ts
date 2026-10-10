import { localizeNotification, type ProductNotificationType } from '@xopcai/gateway-contract';

import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { createLogger } from '../utils/logger.js';

import { getNotificationDevice, listDeliverableNotificationDevices } from './device-store.js';
import { notificationPlanFromGatewayEvent, type NotificationPlan } from './planner.js';
import {
  createNotificationEvent,
  cancelNotificationDelivery,
  deferNotificationDelivery,
  expireUndeliverableNotificationDeliveries,
  listDueNotificationDeliveries,
  markNotificationDeliveryAccepted,
  markNotificationDeliveryDead,
  pruneNotificationEvents,
  rescheduleNotificationDelivery,
  type NotificationDelivery,
} from './store.js';
import type { NotificationPreferences } from './types.js';
import type { NotificationDomainDelivery } from './domain-delivery.js';
import { sendHarmonyPush } from './harmony-push.js';
import { getOrCreateGatewayIdentity } from '../storage/sqlite/gateway-identity-repository.js';
import { flushClarificationNotifications, isClarificationNotificationActionable } from './clarification.js';

const log = createLogger('Notifications');
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

const STANDARD_PREFERENCES: Partial<Record<ProductNotificationType, keyof NotificationPreferences | true>> = {
  'chat.needs_input': 'chatNeedsInput', 'chat.completed': 'chatCompleted', 'chat.failed': 'chatFailed',
  'task.needs_input': 'taskNeedsInput', 'task.blocked': 'taskBlocked',
  'task.failed': 'taskFailed', 'task.completed': 'taskCompleted',
  'automation.completed': 'automationCompleted', 'automation.failed': 'automationFailed',
  'work_discovery.completed': true, 'work_discovery.failed': true,
  'home.opportunity': 'homeOpportunity',
};

function preferenceAllows(type: ProductNotificationType, preferences: NotificationPreferences): boolean {
  const key = STANDARD_PREFERENCES[type];
  return key === true || (key !== undefined && preferences[key]);
}

function retryAt(attempts: number, now: number): number {
  return now + RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)]!;
}

export class NotificationService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private drainAgain = false;
  private lastMaintenanceAt = 0;

  constructor(private readonly options: {
    publish: (type: string, payload: unknown) => void;
    fetch?: typeof fetch;
    domainDelivery?: NotificationDomainDelivery;
    allowsNotification?: (notification: NotificationPlan['notification']) => boolean;
    sendHarmony?: typeof sendHarmonyPush;
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
      if (type === 'clarification.created') {
        void this.drain();
        return;
      }
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
    const plan = notificationPlanFromGatewayEvent(type, payload) ?? this.options.domainDelivery?.planEvent(type, payload);
    if (!plan) return null;
    return this.persistPlan(plan);
  }

  persistPlan(plan: NotificationPlan) {
    if (this.options.allowsNotification?.(plan.notification) === false) return null;
    const domain = this.options.domainDelivery?.owns(plan.notification.type) ? this.options.domainDelivery : undefined;
    if (!domain && !Object.hasOwn(STANDARD_PREFERENCES, plan.notification.type)) {
      throw new Error('Notification domain delivery is not installed');
    }
    const devices = listDeliverableNotificationDevices()
      .filter((device) => domain ? domain.allowsDevice(device.preferences) : preferenceAllows(plan.notification.type, device.preferences));
    const result = runSqliteWriteTransaction(() => {
      const selection = domain?.prepare(plan, devices);
      const created = createNotificationEvent({
        ...(selection?.plan ?? plan), deviceIds: selection?.deviceIds ?? devices.map((device) => device.id),
      });
      if (created.created) selection?.enqueue(created.notification);
      return created;
    });
    return result.created ? result.notification : null;
  }

  async drain(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      const now = Date.now();
      if (now - this.lastMaintenanceAt >= 60 * 60 * 1_000) {
        expireUndeliverableNotificationDeliveries(now);
        pruneNotificationEvents(now - 30 * 24 * 60 * 60 * 1_000);
        this.lastMaintenanceAt = now;
      }
      for (const notification of flushClarificationNotifications(plan => this.persistPlan(plan))) this.options.publish('notification.created', notification);
      for (const notification of this.options.domainDelivery?.flush((plan) => this.persistPlan(plan)) ?? []) this.options.publish('notification.created', notification);
      await this.deliverPending();
      await this.options.domainDelivery?.drain();
    } catch (err) {
      log.warn({ err }, 'Notification delivery pass failed');
    } finally {
      this.draining = false;
      if (this.drainAgain) {
        this.drainAgain = false;
        void this.drain();
      }
    }
  }

  private async deliverPending(): Promise<void> {
    const deliveries = listDueNotificationDeliveries('pending');
    await Promise.all(deliveries.map((delivery) => this.send(delivery)));
  }

  private async send(delivery: NotificationDelivery): Promise<void> {
    if (!isClarificationNotificationActionable(delivery.event)) {
      cancelNotificationDelivery(delivery.event.id, delivery.deviceId);
      return;
    }
    if (this.options.allowsNotification?.(delivery.event) === false) {
      markNotificationDeliveryDead(delivery.event.id, delivery.deviceId, 'Notification policy changed');
      return;
    }
    if (delivery.event.type === 'chat.needs_input' && !getNotificationDevice(delivery.deviceId)?.preferences.chatNeedsInput) {
      cancelNotificationDelivery(delivery.event.id, delivery.deviceId);
      return;
    }
    const domain = this.options.domainDelivery?.owns(delivery.event.type) ? this.options.domainDelivery : undefined;
    if (!domain && !Object.hasOwn(STANDARD_PREFERENCES, delivery.event.type)) {
      markNotificationDeliveryDead(delivery.event.id, delivery.deviceId, 'Notification domain delivery is not installed');
      return;
    }
    if (domain) {
      const policy = domain.recheckMobile(delivery.event);
      if (policy === 'cancel') { markNotificationDeliveryDead(delivery.event.id, delivery.deviceId, 'Notification policy changed'); return; }
      if (policy instanceof Date) { deferNotificationDelivery(delivery.event.id, delivery.deviceId, policy.getTime()); return; }
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const localized = localizeNotification(delivery.event, delivery.locale);
    const preview = domain?.mobilePreview(delivery.event, delivery.locale) ?? { title: localized.localizedTitle, body: localized.localizedBody };
    try {
      if (delivery.platform !== 'harmonyos') {
        markNotificationDeliveryDead(delivery.event.id, delivery.deviceId, 'Native push provider is not configured');
        return;
      }
      const ticket = await (this.options.sendHarmony ?? sendHarmonyPush)({
        pushToken: delivery.pushToken, eventId: delivery.event.id,
        gatewayId: getOrCreateGatewayIdentity().id, target: delivery.event.target,
        title: preview.title,
        body: preview.body,
        ...(delivery.event.type === 'chat.needs_input' && typeof delivery.event.payload.expiresAt === 'number'
          ? { expiresAt: delivery.event.payload.expiresAt } : {}),
      }, fetchImpl);
      // Huawei Push Kit V3 exposes provider acceptance but no device delivery receipt.
      markNotificationDeliveryAccepted(delivery.event.id, delivery.deviceId, ticket, Number.MAX_SAFE_INTEGER);
    } catch (err) {
      this.retryOrFail(delivery, err);
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
