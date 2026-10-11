import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buckets } from '../../../rate-limit/index.js';
import { publicDeviceRateLimit } from '../public-device-rate-limit.js';

describe('public device admission limits', () => {
  beforeEach(() => buckets.resetAllForTests());
  afterEach(() => buckets.resetAllForTests());

  it('bounds pre-auth work even when the socket address is unavailable and ignores untrusted forwarded headers', async () => {
    let work = 0;
    const app = new Hono();
    app.use('/public', publicDeviceRateLimit('test'));
    app.post('/public', c => { work++; return c.json({ ok: true }); });
    for (let i = 0; i < 300; i++) {
      expect((await app.request('/public', { method: 'POST', headers: { 'X-Forwarded-For': `192.0.2.${i % 250}` } })).status).toBe(200);
    }
    const response = await app.request('/public', { method: 'POST', headers: { 'X-Forwarded-For': '198.51.100.1' } });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    expect(work).toBe(300);
  });

  it('keeps authenticated traffic and unrelated public families independent', async () => {
    const app = new Hono();
    app.use('/public', publicDeviceRateLimit('pairing'));
    app.get('/public', c => c.text('ok'));
    app.use('/identity', publicDeviceRateLimit('identity'));
    app.get('/identity', c => c.text('ok'));
    app.get('/authenticated', c => c.text('ok'));
    for (let i = 0; i < 301; i++) await app.request('/public');
    expect((await app.request('/identity')).status).toBe(200);
    expect((await app.request('/authenticated')).status).toBe(200);
  });
});
