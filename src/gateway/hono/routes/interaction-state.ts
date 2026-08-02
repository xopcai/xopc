import type { Hono } from 'hono';

import { getInteractionState, setInteractionState } from '../../../storage/sqlite/index.js';
import type { SupportNeed } from '../../../user-context/interaction-state.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const SUPPORT_NEEDS = new Set<SupportNeed>(['listen', 'clarify', 'advise', 'act', 'unknown']);

export function registerInteractionStateRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/interaction-state', (c) => {
    const sessionKey = c.req.query('sessionKey')?.trim() ?? '';
    if (!sessionKey) return c.json({ error: 'sessionKey is required' }, 400);
    const state = getInteractionState(sessionKey);
    return state ? c.json({ ok: true, state }) : c.json({ ok: false, error: 'Interaction state not found' }, 404);
  });

  authenticated.patch('/api/interaction-state', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    const sessionKey = body && typeof body === 'object' && typeof body.sessionKey === 'string'
      ? body.sessionKey.trim()
      : '';
    const supportNeed = body && typeof body === 'object' && SUPPORT_NEEDS.has(body.supportNeed)
      ? body.supportNeed as SupportNeed
      : undefined;
    if (!sessionKey || !supportNeed) return c.json({ error: 'sessionKey and a valid supportNeed are required' }, 400);
    const state = setInteractionState({
      sessionKey,
      signal: {
        supportNeed,
        confidence: 1,
        source: 'explicit',
        repairStatus: 'none',
      },
    });
    return c.json({ ok: true, state });
  });
}
