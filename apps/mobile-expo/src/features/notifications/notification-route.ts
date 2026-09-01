import { notificationTargetRoute, parseNotificationTarget } from '@xopcai/gateway-contract';

/** Limits push-provided routes to app-owned destinations before navigation. */
export function resolveNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const target = parseNotificationTarget((data as { target?: unknown }).target);
  return target ? notificationTargetRoute(target, 'mobile') : null;
}
