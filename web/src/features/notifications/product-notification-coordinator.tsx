import { useEffect } from 'react';

import { deliverBrowserNotification } from '@/features/notifications/browser-notification-delivery';
import { deliverElectronNotification } from '@/features/notifications/electron-notification-delivery';
import {
  acknowledgeProductNotification,
  fetchNotificationCatchUp,
  isNotificationActionable,
  saveNotificationCursor,
} from '@/features/notifications/notification-api';
import {
  parseProductNotification,
  presentProductNotification,
} from '@/features/notifications/product-notification';
import { isPersonalNotificationViewed, isClarificationNotificationViewed } from '@/features/notifications/notification-policy';
import { showActivity, useActivityStore } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';

export function ProductNotificationCoordinator() {
  const language = useLocaleStore((state) => state.language);

  useEffect(() => {
    let active = true;
    let catchUp: Promise<void> | null = null;
    const seen = new Set<string>();
    const waiting = new Map<string, string>();
    let consumption = Promise.resolve();

    const consume = (value: unknown, systemEligible = true, advanceCursor = true): Promise<void> => {
      consumption = consumption.catch(() => {}).then(async () => {
        if (!active) return;
        const event = parseProductNotification(value);
        if (!event) return;
        if (seen.has(event.id)) {
          if (advanceCursor) saveNotificationCursor(event.id);
          return;
        }
        const actionable = await isNotificationActionable(event);
        if (!active) return;
        seen.add(event.id);
        if (!actionable) {
          if (advanceCursor) saveNotificationCursor(event.id);
          return;
        }
        const notification = presentProductNotification(event, language);
        if (notification.waitId) waiting.set(notification.waitId, event.id);
        if (!(notification.waitId ? isClarificationNotificationViewed(notification) : isPersonalNotificationViewed(notification))) showActivity({
          tone: notification.status === 'attention' ? 'warning' : notification.status === 'success' ? 'success' : 'error',
          title: notification.title,
          message: notification.body,
          source: notification.source,
          href: notification.route,
          dedupeKey: notification.id,
        });
        if (systemEligible && (event.type !== 'chat.needs_input' || event.createdAt >= Date.now() - 5 * 60_000)) {
          void deliverElectronNotification(notification);
          void deliverBrowserNotification(notification);
        }
        if (advanceCursor) saveNotificationCursor(event.id);
        void acknowledgeProductNotification(event.id);
      });
      return consumption;
    };

    const runCatchUp = () => {
      if (catchUp) return catchUp;
      catchUp = fetchNotificationCatchUp()
        .then(async (items) => {
          if (active) {
            const recentCutoff = Date.now() - 5 * 60_000;
            for (const item of items) await consume(item, item.createdAt >= recentCutoff);
          }
        })
        .catch(() => {})
        .finally(() => { catchUp = null; });
      return catchUp;
    };

    const onNotification = (raw: Event) => {
      void consume((raw as CustomEvent<unknown>).detail, true, false).catch(() => {});
      void runCatchUp().then(() => runCatchUp());
    };
    const onRealtimeGap = () => void runCatchUp();
    const onClarification = (raw: Event) => {
      const wait = (raw as CustomEvent<{ id: string; status: string }>).detail;
      if (!wait || wait.status === 'open') return;
      const eventId = waiting.get(wait.id);
      if (!eventId) return;
      const store = useActivityStore.getState();
      for (const item of store.items) if (item.dedupeKey === eventId) store.remove(item.id);
      waiting.delete(wait.id);
    };
    window.addEventListener('clarification-updated', onClarification);
    window.addEventListener('notification-created', onNotification);
    window.addEventListener('realtime-gap', onRealtimeGap);
    void runCatchUp();

    const onServiceWorkerMessage = (raw: MessageEvent<unknown>) => {
      const message = raw.data as { type?: unknown; route?: unknown } | null;
      if (message?.type !== 'xopc:notification-click' || typeof message.route !== 'string') return;
      if (message.route.startsWith('/') && !message.route.startsWith('//')) {
        window.location.hash = message.route;
      }
    };
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
    return () => {
      active = false;
      window.removeEventListener('clarification-updated', onClarification);
      window.removeEventListener('notification-created', onNotification);
      window.removeEventListener('realtime-gap', onRealtimeGap);
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    };
  }, [language]);

  return null;
}
