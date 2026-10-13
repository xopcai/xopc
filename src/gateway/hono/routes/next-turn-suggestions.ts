import type { Hono } from 'hono';
import { nextTurnSuggestionFeedbackSchema } from '@xopcai/gateway-contract';

import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import { recordNextTurnSuggestionFeedback } from '../../../storage/sqlite/next-turn-suggestion-repository.js';
import { createGatewayRouteLogger } from '../lib/route-logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createGatewayRouteLogger('NextTurnSuggestions');

export function registerNextTurnSuggestionRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.get('/api/sessions/:key/next-turn-suggestion', c => {
    c.header('Cache-Control', 'no-store');
    if (!deps.service.isGatewayReady()) return c.json({ status: 'none' }, 503);
    const conversationId = c.req.param('key');
    if (!getSessionMetadata(conversationId)) return c.json({ error: 'Session not found' }, 404);
    const locale = c.req.query('locale') ?? 'en';
    if (locale !== 'zh' && locale !== 'en') return c.json({ error: 'Invalid locale' }, 400);
    try {
      return c.json(deps.service.agentRunner.nextTurnSuggestions.get(conversationId, locale));
    } catch (err) {
      log.debug({ err, conversationId }, 'Next turn suggestion unavailable');
      return c.json({ status: 'none' });
    }
  });
  app.post('/api/sessions/:key/next-turn-suggestion-feedback', deps.strictRateLimitMiddleware, async c => {
    if (!deps.service.isGatewayReady()) return c.json({ ok: false }, 503);
    const conversationId = c.req.param('key');
    if (!getSessionMetadata(conversationId)) return c.json({ error: 'Session not found' }, 404);
    const body = nextTurnSuggestionFeedbackSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid feedback' }, 400);
    return recordNextTurnSuggestionFeedback(conversationId, body.data)
      ? c.json({ ok: true }) : c.json({ error: 'Suggestion not found' }, 404);
  });
}
