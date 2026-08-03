import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { createXopcCloudPollRateLimitMiddleware } from '../../hono/middleware/strict-rate-limit.js';
import { buckets } from '../index.js';

describe('XOPC Cloud polling rate limit', () => {
  beforeEach(() => {
    buckets.resetAllForTests();
  });

  it('allows the expected two-second polling cadence without consuming the strict bucket', async () => {
    const app = new Hono();
    app.use(
      '/poll',
      createXopcCloudPollRateLimitMiddleware({ getTrustedProxyContext: () => ({}) }),
    );
    app.post('/poll', (c) => c.json({ ok: true }));

    for (let request = 0; request < 30; request += 1) {
      expect((await app.request('/poll', { method: 'POST' })).status).toBe(200);
    }

    expect(buckets.strictApi().consume('127.0.0.1').remaining).toBe(14);
  });
});
