import type { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticatedRouteDeps } from './deps.js';

const actionSchema = z.object({
  waitId: z.string().min(1), expectedSessionId: z.string().min(1), expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(200),
  action: z.enum(['connect', 'check', 'continue', 'skip', 'cancel', 'select_account', 'confirm_scope', 'replace_source']),
  candidateRef: z.string().optional(), needKey: z.string().optional(), accountId: z.string().optional(),
}).strict();

export function registerConnectionWaitRoutes(app: Hono, { service, strictRateLimitMiddleware }: AuthenticatedRouteDeps): void {
  app.get('/api/sessions/:sessionKey/connection-wait', c => {
    try { return c.json({ ok: true, payload: service.connectionRecovery.snapshot(c.req.param('sessionKey')) }); }
    catch { return c.json({ ok: false, error: 'Session unavailable' }, 404); }
  });
  app.post('/api/sessions/:sessionKey/connection-wait/actions', strictRateLimitMiddleware, async c => {
    const parsed = actionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ ok: false, error: 'Invalid connection action' }, 400);
    try {
      const payload = await service.connectionRecovery.act(c.req.param('sessionKey'), parsed.data);
      return c.json({ ok: true, payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection check failed';
      return c.json({ ok: false, error: message }, ['SESSION_CHANGED', 'WAIT_CHANGED'].includes(message) ? 409 : 400);
    }
  });
}
