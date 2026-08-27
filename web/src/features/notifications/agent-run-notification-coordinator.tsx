import { useEffect } from 'react';

import {
  buildAgentRunNotification,
  parseAgentRunEndedEvent,
} from '@/features/notifications/agent-run-notification';
import {
  buildAutomationRunNotification,
  parseAutomationRunCompletedEvent,
} from '@/features/notifications/automation-run-notification';
import { deliverBrowserNotification } from '@/features/notifications/browser-notification-delivery';
import { deliverElectronNotification } from '@/features/notifications/electron-notification-delivery';
import { showActivity } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';

export function AgentRunNotificationCoordinator() {
  const language = useLocaleStore((state) => state.language);

  useEffect(() => {
    const onRunEnded = (raw: Event) => {
      const event = parseAgentRunEndedEvent((raw as CustomEvent<unknown>).detail);
      if (!event) return;
      const notification = buildAgentRunNotification(event, language);
      if (!notification) return;
      showActivity({
        tone: notification.status === 'success' ? 'success' : 'error',
        title: notification.title,
        message: notification.body,
        source: 'chat',
        href: notification.route,
        dedupeKey: notification.id,
      });
      void deliverElectronNotification(notification);
      void deliverBrowserNotification(notification);
    };

    window.addEventListener('agent-run-ended', onRunEnded);
    const onAutomationRunCompleted = (raw: Event) => {
      const event = parseAutomationRunCompletedEvent((raw as CustomEvent<unknown>).detail);
      if (!event) return;
      const notification = buildAutomationRunNotification(event, language);
      if (!notification) return;
      showActivity({
        tone: notification.status === 'success' ? 'success' : 'error',
        title: notification.title,
        message: notification.body,
        source: 'automation',
        href: notification.route,
        dedupeKey: notification.id,
      });
      void deliverElectronNotification(notification);
      void deliverBrowserNotification(notification);
    };
    window.addEventListener('automation-run-completed', onAutomationRunCompleted);
    const onServiceWorkerMessage = (raw: MessageEvent<unknown>) => {
      const message = raw.data as { type?: unknown; route?: unknown } | null;
      if (message?.type !== 'xopc:notification-click' || typeof message.route !== 'string') return;
      if (message.route.startsWith('/chat/')) window.location.hash = message.route;
    };
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
    return () => {
      window.removeEventListener('agent-run-ended', onRunEnded);
      window.removeEventListener('automation-run-completed', onAutomationRunCompleted);
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    };
  }, [language]);

  return null;
}
