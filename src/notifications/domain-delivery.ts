import type { ProductNotification, ProductNotificationType } from '@xopcai/gateway-contract';

import type { NotificationPlan } from './planner.js';
import type { NotificationDevice, NotificationPreferences } from './types.js';

/** Domain decisions are injected by the host; transports never load domain runtimes. */
export interface NotificationDomainDelivery {
  owns(type: ProductNotificationType): boolean;
  allowsDevice(preferences: NotificationPreferences): boolean;
  planEvent(type: string, payload: unknown): NotificationPlan | null;
  prepare(plan: NotificationPlan, devices: NotificationDevice[]): {
    plan: NotificationPlan;
    deviceIds: string[];
    // Runs in the event persistence transaction, only for a newly created event.
    enqueue(notification: ProductNotification): void;
  };
  flush(persist: (plan: NotificationPlan) => ProductNotification | null): ProductNotification[];
  drain(): Promise<void>;
  recheckMobile(notification: ProductNotification): 'send' | 'cancel' | Date;
  mobilePreview(notification: ProductNotification, locale: string): { title: string; body: string };
}
