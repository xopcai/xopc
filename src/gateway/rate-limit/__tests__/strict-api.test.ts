import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { createStrictRateLimitMiddleware } from '../../hono/middleware/strict-rate-limit.js';
import { buckets } from '../index.js';

describe('Strict API rate limit', () => {
  beforeEach(() => {
    buckets.resetAllForTests();
  });

  it('allows 150 authenticated UI mutations per minute for one client', async () => {
    const app = new Hono();
    app.use(
      '/write',
      createStrictRateLimitMiddleware({ getTrustedProxyContext: () => ({}) }),
    );
    app.post('/write', (c) => c.json({ ok: true }));

    for (let request = 0; request < 150; request += 1) {
      const response = await app.request('/write', { method: 'POST' });
      expect(response.status).toBe(200);
    }

    const blocked = await app.request('/write', { method: 'POST' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
  });
});
