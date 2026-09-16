import type { Hono } from 'hono';

import { getInteractionState, setInteractionState } from '../../../storage/sqlite/index.js';
import type { SupportNeed } from '../../../user-context/interaction-state.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const SUPPORT_NEEDS = new Set<SupportNeed>(['listen', 'clarify', 'advise', 'act', 'unknown']);

export function registerInteractionStateRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/interaction-state', (c) => {
    const conversationId = c.req.query('conversationId')?.trim() ?? '';
    if (!conversationId) return c.json({ error: 'conversationId is required' }, 400);
    const state = getInteractionState(conversationId);
    return state ? c.json({ ok: true, state }) : c.json({ ok: false, error: 'Interaction state not found' }, 404);
  });

  authenticated.patch('/api/interaction-state', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    const conversationId = body && typeof body === 'object' && typeof body.conversationId === 'string'
      ? body.conversationId.trim()
      : '';
    const supportNeed = body && typeof body === 'object' && SUPPORT_NEEDS.has(body.supportNeed)
      ? body.supportNeed as SupportNeed
      : undefined;
    if (!conversationId || !supportNeed) return c.json({ error: 'conversationId and a valid supportNeed are required' }, 400);
    const state = setInteractionState({
      conversationId,
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
