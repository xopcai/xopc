import { sessionInputControlCommandSchema } from '@xopcai/gateway-contract';
import type { Hono } from 'hono';

import { SessionInputControlConflict } from '../../../storage/sqlite/session-input-control-repository.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerSessionInputControlRoutes(authenticated: Hono, { service, chatRateLimitMiddleware }: AuthenticatedRouteDeps): void {
  authenticated.post('/api/sessions/:conversationId/input-control', chatRateLimitMiddleware, async c => {
    const command = sessionInputControlCommandSchema.safeParse(await c.req.json().catch(() => null));
    if (!command.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid input control' } }, 400);
    try {
      const state = await service.controlSessionInputs(c.req.param('conversationId'), command.data);
      return c.json({ ok: true, payload: state }, state.control.phase === 'stopping' ? 202 : 200);
    } catch (error) {
      if (!(error instanceof SessionInputControlConflict)) throw error;
      return c.json({ ok: false, error: { code: 'CONFLICT', message: error.message },
        payload: service.getSessionInputState(c.req.param('conversationId')) }, 409);
    }
  });

}
