import { localizeNotification, type ProductNotificationType } from '@xopcai/gateway-contract';

import { createLogger } from '../utils/logger.js';

import {
  disableNotificationDeviceForPushToken,
  listDeliverableNotificationDevices,
} from './device-store.js';
import { notificationPlanFromGatewayEvent } from './planner.js';
import {
  createNotificationEvent,
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
      const plan = notificationPlanFromGatewayEvent(type, payload);
      if (!plan) return;
      const devices = listDeliverableNotificationDevices()
        .filter((device) => preferenceAllows(plan.notification.type, device.preferences));
      const result = createNotificationEvent({
        ...plan,
        deviceIds: devices.map((device) => device.id),
      });
      if (!result.created) return;
      this.options.publish('notification.created', result.notification);
      void this.drain();
    } catch (err) {
      log.error({ err, eventType: type }, 'Notification event persistence failed');
    }
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
      await this.deliverPending();
      await this.checkReceipts();
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
    const fetchImpl = this.options.fetch ?? fetch;
    const localized = localizeNotification(delivery.event, delivery.locale);
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          to: delivery.pushToken,
          title: localized.localizedTitle,
          body: localized.localizedBody,
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
