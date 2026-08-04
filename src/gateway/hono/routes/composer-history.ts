import type { Hono } from 'hono';

import {
  appendComposerInputHistory,
  clearComposerInputHistory,
  listComposerInputHistory,
} from '../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const MAX_TEXT_LENGTH = 100_000;

export function registerComposerHistoryRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/composer-history', (c) => {
    return c.json({ items: listComposerInputHistory() });
  });

  authenticated.post('/api/composer-history', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    const text = body && typeof body === 'object' && typeof body.text === 'string'
      ? body.text.trim()
      : '';
    if (!text) return c.json({ error: 'text is required' }, 400);
    if (text.length > MAX_TEXT_LENGTH) return c.json({ error: 'text is too long' }, 413);

    const result = appendComposerInputHistory(text);
    if (result.inserted) deps.service.emit('composer-history.appended', result.item);
    return c.json(result);
  });

  authenticated.delete('/api/composer-history', deps.strictRateLimitMiddleware, (c) => {
    const cleared = clearComposerInputHistory();
    if (cleared > 0) deps.service.emit('composer-history.cleared', { cleared });
    return c.json({ ok: true, cleared });
  });
}
