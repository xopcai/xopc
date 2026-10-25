// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { deliverBrowserNotification } from '../browser-notification-delivery';
import { setBrowserNotificationPreferences } from '../browser-notification-preferences';
import { wasNotificationDelivered } from '../notification-delivery-history';
import { presentProductNotification } from '../product-notification';

const workerSource = readFileSync(resolve(process.cwd(), 'web/public/notification-sw.js'), 'utf8');
const showNotification = vi.fn(async (_title: string, _options: NotificationOptions) => {});
const register = vi.fn(async () => ({ showNotification }));
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register, ready: Promise.resolve({}) } });
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  setBrowserNotificationPreferences({ enabled: true, completed: true, failed: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

function notification(runId: string, failed: boolean) {
  return presentProductNotification({ schemaVersion: 1, id: `event-${runId}`, type: failed ? 'automation.failed' : 'automation.completed',
    target: { kind: 'automation_run', automationId: 'task one', runId }, title: { en: 'Daily check', zh: '每日检查' },
    body: { en: failed ? 'Needs attention' : 'Done', zh: failed ? '需要处理' : '已完成' }, priority: failed ? 'high' : 'normal', payload: {}, createdAt: 1 }, 'zh');
}

it.each([false, true])('persists the %s notification execution through system delivery and clicking after the app closes', async failed => {
  const original = notification('original/one', failed);
  expect(await deliverBrowserNotification(original)).toBe(true);
  const options = structuredClone(showNotification.mock.calls[0][1]);
  expect(options.data).toEqual({ route: '/automations?automation=task%20one&run=original%2Fone' });
  expect(wasNotificationDelivered(original.id)).toBe(true);
  await deliverBrowserNotification(notification('newer', failed));
  expect(await deliverBrowserNotification(original)).toBe(false);
  expect(showNotification).toHaveBeenCalledTimes(2);
  const handlers = new Map<string, (event: unknown) => void>();
  const openWindow = vi.fn(async () => ({}));
  runInNewContext(workerSource, { URL, self: { registration: { scope: 'https://xopc.test/' }, addEventListener: (type: string, callback: (event: unknown) => void) => handlers.set(type, callback),
    clients: { matchAll: async () => [], openWindow } } });
  let pending = Promise.resolve();
  handlers.get('notificationclick')!({ notification: { data: options.data, close: vi.fn() }, waitUntil: (promise: Promise<void>) => { pending = promise; } });
  await pending;
  expect(openWindow).toHaveBeenCalledExactlyOnceWith('https://xopc.test/#/automations?automation=task%20one&run=original%2Fone');
});

it('does not mark an unsuccessful system delivery as delivered and allows a later retry', async () => {
  showNotification.mockRejectedValueOnce(new Error('OS delivery failed'));
  const item = notification('retry-run', false);
  expect(await deliverBrowserNotification(item)).toBe(false);
  expect(wasNotificationDelivered(item.id)).toBe(false);
  expect(await deliverBrowserNotification(item)).toBe(true);
  expect(wasNotificationDelivered(item.id)).toBe(true);
});

it('does not show a native popup while the app is focused', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  expect(await deliverBrowserNotification(notification('focused', false))).toBe(false);
  expect(showNotification).not.toHaveBeenCalled();
});
