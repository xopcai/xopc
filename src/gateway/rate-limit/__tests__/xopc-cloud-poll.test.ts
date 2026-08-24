import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTaskRateLimitMiddleware, createXopcCloudPollRateLimitMiddleware } from '../../hono/middleware/strict-rate-limit.js';
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

  it('allows high-frequency task interactions without consuming the strict bucket', async () => {
    const app = new Hono();
    app.use(
      '/tasks',
      createTaskRateLimitMiddleware({ getTrustedProxyContext: () => ({}) }),
    );
    app.post('/tasks', (c) => c.json({ ok: true }));

    for (let request = 0; request < 300; request += 1) {
      expect((await app.request('/tasks', { method: 'POST' })).status).toBe(200);
    }
    const blocked = await app.request('/tasks', { method: 'POST' });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(buckets.strictApi().consume('127.0.0.1').remaining).toBe(14);
  });
});
