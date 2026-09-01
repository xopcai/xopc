import type { Hono } from 'hono';

import {
  acknowledgeNotification,
  listNotificationEvents,
  notificationDeliveryMetrics,
} from '../../../notifications/store.js';

import type { AuthenticatedRouteDeps } from './deps.js';

function integerQuery(value: string | undefined, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : undefined;
}

function stringField(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

export function registerNotificationRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/notifications', (c) => {
    const result = listNotificationEvents({
      afterId: c.req.query('after')?.trim() || undefined,
      since: integerQuery(c.req.query('since'), 0, Number.MAX_SAFE_INTEGER),
      limit: integerQuery(c.req.query('limit'), 1, 100),
    });
    return c.json({ ok: true, ...result });
  });

  authenticated.post('/api/notifications/:id/ack', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const consumerId = stringField(body?.consumerId, 160);
    const surface = body?.surface;
    if (!consumerId || (surface !== 'web' && surface !== 'electron' && surface !== 'mobile')) {
      return c.json({ ok: false, error: 'Invalid notification acknowledgement' }, 400);
    }
    if (!acknowledgeNotification(c.req.param('id'), consumerId, surface)) {
      return c.json({ ok: false, error: 'Notification not found' }, 404);
    }
    return c.json({ ok: true });
  });

  authenticated.get('/api/notifications/metrics', (c) => {
    return c.json({ ok: true, deliveries: notificationDeliveryMetrics() });
  });
}
