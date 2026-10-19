import { conversationIdSchema } from '@xopcai/gateway-contract';
import type { Hono } from 'hono';

import {
  appendComposerInputHistory,
  clearComposerInputHistory,
  listComposerInputHistory,
} from '../../../storage/sqlite/index.js';
import { getSessionMetadata } from '../../../storage/sqlite/session-repository.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const MAX_TEXT_LENGTH = 100_000;

export function registerComposerHistoryRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/composer-history', (c) => {
    const conversationId = c.req.query('conversationId');
    if (!conversationId || !conversationIdSchema.safeParse(conversationId).success) return c.json({ error: 'valid conversationId is required' }, 400);
    if (!getSessionMetadata(conversationId)) return c.json({ error: 'conversation not found' }, 404);
    return c.json({ items: listComposerInputHistory(conversationId) });
  });

  authenticated.post('/api/composer-history', deps.chatRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    const conversationId = body?.conversationId;
    if (typeof conversationId !== 'string' || !conversationIdSchema.safeParse(conversationId).success) return c.json({ error: 'valid conversationId is required' }, 400);
    if (!getSessionMetadata(conversationId)) return c.json({ error: 'conversation not found' }, 404);
    const text = body && typeof body === 'object' && typeof body.text === 'string'
      ? body.text.trim()
      : '';
    if (!text) return c.json({ error: 'text is required' }, 400);
    if (text.length > MAX_TEXT_LENGTH) return c.json({ error: 'text is too long' }, 413);

    const result = appendComposerInputHistory(conversationId, text);
    if (result.inserted) deps.service.emit('composer-history.appended', result.item);
    return c.json(result);
  });

  authenticated.delete('/api/composer-history', deps.strictRateLimitMiddleware, (c) => {
    const conversationId = c.req.query('conversationId');
    if (!conversationId || !conversationIdSchema.safeParse(conversationId).success) return c.json({ error: 'valid conversationId is required' }, 400);
    if (!getSessionMetadata(conversationId)) return c.json({ error: 'conversation not found' }, 404);
    const cleared = clearComposerInputHistory(conversationId);
    if (cleared > 0) deps.service.emit('composer-history.cleared', { conversationId, cleared });
    return c.json({ ok: true, cleared });
  });
}
