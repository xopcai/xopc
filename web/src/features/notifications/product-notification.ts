import {
  localizeNotification,
  notificationTargetRoute,
  ProductNotificationSchema,
  type NotificationTarget,
  type ProductNotification,
} from '@xopcai/gateway-contract';

import type { StoredLanguage } from '@/lib/storage';

export type ProductNotificationPresentation = {
  systemAllowed?: boolean;
  id: string;
  title: string;
  body: string;
  route: string;
  target: NotificationTarget;
  status: 'success' | 'error';
  source: 'chat' | 'task' | 'automation' | 'insight' | 'understanding';
};

export function parseProductNotification(value: unknown): ProductNotification | null {
  const parsed = ProductNotificationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function presentProductNotification(
  notification: ProductNotification,
  language: StoredLanguage,
): ProductNotificationPresentation {
  const localized = localizeNotification(notification, language);
  const failed = notification.type === 'chat.failed'
    || notification.type === 'task.blocked'
    || notification.type === 'task.failed'
    || notification.type === 'task.needs_input'
    || notification.type === 'automation.failed'
    || notification.type === 'work_discovery.failed';
  const source = notification.target.kind === 'automation_run'
    ? 'automation'
    : (notification.target.kind === 'insight' || notification.target.kind === 'proactive_digest')
      ? 'insight'
      : notification.target.kind === 'work_discovery'
        ? 'understanding'
        : notification.target.kind;
  return {
    systemAllowed: notification.payload.deliveryMode !== 'auto' && (!notification.payload.deliveryChannel || ['all', 'browser'].includes(String(notification.payload.deliveryChannel))),
    id: notification.id,
    title: localized.localizedTitle,
    body: localized.localizedBody ?? localized.localizedTitle,
    route: notificationTargetRoute(notification.target, 'web'),
    target: notification.target,
    status: failed ? 'error' : 'success',
    source,
  };
}
