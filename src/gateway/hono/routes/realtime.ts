import { realtimeClientKindSchema } from '@xopcai/realtime-protocol';
import type { Hono } from 'hono';
import { z } from 'zod';

import type { AuthenticatedRouteDeps } from './deps.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';

const ticketRequestSchema = z.strictObject({
  clientId: z.string().min(1).max(160),
  clientKind: realtimeClientKindSchema,
});

export function registerRealtimeRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.post('/api/realtime/tickets', async (c) => {
    const parsed = ticketRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid realtime ticket request' } }, 400);
    }
    try {
      const principal = getGatewayPrincipal(c);
      return c.json({ ok: true, payload: deps.service.realtime.tickets.issue(
        parsed.data.clientId,
        parsed.data.clientKind,
        {
          principalId: principal.principalId,
          ...(principal.deviceId ? { deviceId: principal.deviceId } : {}),
          ...(principal.accessSessionId ? { accessSessionId: principal.accessSessionId } : {}),
          scopes: principal.scopes,
        },
      ) });
    } catch (error) {
      return c.json({
        ok: false,
        error: { code: 'TICKET_LIMIT', message: error instanceof Error ? error.message : 'Ticket issue failed' },
      }, 503);
    }
  });
}
