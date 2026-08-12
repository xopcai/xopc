import type { Hono } from 'hono';

import type { PublishEventInput } from '../../../proactive/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** User-facing judgment inbox plus internal diagnostics. There is intentionally no proactive control-panel API. */
export function registerProactiveRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/inbox/judgments', (c) => {
    const status = c.req.query('status');
    if (status && !['unread', 'read', 'snoozed', 'resolved'].includes(status)) return c.json({ ok: false, error: 'Invalid inbox status' }, 400);
    return c.json({ ok: true, items: deps.service.proactiveInbox.list({
      ...(status ? { status: status as 'unread' | 'read' | 'snoozed' | 'resolved' } : {}),
      limit: positiveInt(c.req.query('limit'), 50),
    }) });
  });

  authenticated.post('/api/inbox/judgments/:itemId/transition', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !['unread', 'read', 'snoozed', 'resolved'].includes(String(body.status))) return c.json({ ok: false, error: 'Valid status is required' }, 400);
    try {
      return c.json({ ok: true, item: deps.service.proactiveInbox.transition(c.req.param('itemId'), {
        status: body.status as 'unread' | 'read' | 'snoozed' | 'resolved',
        ...(typeof body.snoozedUntil === 'string' ? { snoozedUntil: body.snoozedUntil } : {}),
        ...(typeof body.resolution === 'string' ? { resolution: body.resolution } : {}),
      }) });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });

  authenticated.post('/api/inbox/judgments/:itemId/decisions', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.choice !== 'string') return c.json({ ok: false, error: 'choice is required' }, 400);
    try { return c.json({ ok: true, item: deps.service.proactiveInbox.decide(c.req.param('itemId'), body.choice, typeof body.note === 'string' ? body.note : '') }, 201); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });

  authenticated.post('/api/inbox/judgments/:itemId/feedback', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || (body.rating !== 'useful' && body.rating !== 'not_useful')) return c.json({ ok: false, error: 'Valid rating is required' }, 400);
    try { deps.service.proactiveInbox.feedback(c.req.param('itemId'), body.rating, typeof body.note === 'string' ? body.note : ''); return c.json({ ok: true }, 201); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });

  authenticated.post('/api/inbox/judgments/:itemId/instructions', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.instruction !== 'string' || !body.instruction.trim()) return c.json({ ok: false, error: 'instruction is required' }, 400);
    try { return c.json({ ok: true, ...deps.service.proactiveInbox.instruct(c.req.param('itemId'), body.instruction) }, 201); }
    catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });

  authenticated.get('/api/internal/proactive/insights', (c) => c.json({ ok: true, insights: deps.service.proactiveInsights() }));
  authenticated.get('/api/internal/proactive/scenarios', (c) => c.json({
    ok: true,
    scenarios: deps.service.proactiveScenarios.list(),
    subscriptions: deps.service.proactiveScenarios.subscriptions(),
  }));
  authenticated.post('/api/internal/proactive/events', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ ok: false, error: 'Event body must be an object' }, 400);
    try {
      const result = deps.service.proactive.publish(body as PublishEventInput);
      return c.json({ ok: true, ...result }, result.inserted ? 201 : 200);
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  authenticated.get('/api/internal/proactive/events', (c) => {
    const events = deps.service.proactive.listEvents({ limit: positiveInt(c.req.query('limit'), 50), ...(c.req.query('type') ? { type: c.req.query('type') } : {}) })
      .map((event) => event.sensitivity === 'public' || event.sensitivity === 'personal' ? event : { ...event, payload: { redacted: true } });
    return c.json({ ok: true, events });
  });
  authenticated.get('/api/internal/proactive/batches', (c) => c.json({ ok: true, batches: deps.service.proactive.listBatches({ limit: positiveInt(c.req.query('limit'), 50) }) }));
  authenticated.get('/api/internal/proactive/health', (c) => c.json({ ok: true, health: deps.service.proactive.health() }));
}
