import { useEffect } from 'react';

import { deliverBrowserNotification } from '@/features/notifications/browser-notification-delivery';
import { deliverElectronNotification } from '@/features/notifications/electron-notification-delivery';
import {
  acknowledgeProductNotification,
  fetchNotificationCatchUp,
  saveNotificationCursor,
} from '@/features/notifications/notification-api';
import {
  parseProductNotification,
  presentProductNotification,
} from '@/features/notifications/product-notification';
import { showActivity } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';

export function ProductNotificationCoordinator() {
  const language = useLocaleStore((state) => state.language);

  useEffect(() => {
    let active = true;
    let catchUp: Promise<void> | null = null;
    const seen = new Set<string>();

    const consume = (value: unknown, systemEligible = true, advanceCursor = true) => {
      const event = parseProductNotification(value);
      if (!event) return;
      if (seen.has(event.id)) {
        if (advanceCursor) saveNotificationCursor(event.id);
        return;
      }
      seen.add(event.id);
      const notification = presentProductNotification(event, language);
      showActivity({
        tone: notification.status === 'success' ? 'success' : 'error',
        title: notification.title,
        message: notification.body,
        source: notification.source,
        href: notification.route,
        dedupeKey: notification.id,
      });
      if (systemEligible) {
        void deliverElectronNotification(notification);
        void deliverBrowserNotification(notification);
      }
      if (advanceCursor) saveNotificationCursor(event.id);
      void acknowledgeProductNotification(event.id);
    };

    const runCatchUp = () => {
      if (catchUp) return catchUp;
      catchUp = fetchNotificationCatchUp()
        .then((items) => {
          if (active) {
            const recentCutoff = Date.now() - 5 * 60_000;
            items.forEach((item) => consume(item, item.createdAt >= recentCutoff));
          }
        })
        .finally(() => { catchUp = null; });
      return catchUp;
    };

    const onNotification = (raw: Event) => {
      consume((raw as CustomEvent<unknown>).detail, true, false);
      void runCatchUp().then(() => runCatchUp());
    };
    const onRealtimeGap = () => void runCatchUp();
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
      window.removeEventListener('notification-created', onNotification);
      window.removeEventListener('realtime-gap', onRealtimeGap);
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    };
  }, [language]);

  return null;
}
