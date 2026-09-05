import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { auth } from '../../middleware/auth.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';

describe('authenticated lazy voice context', () => {
  afterEach(() => resetLazyRouteBundlesForTests());

  function mount(app: Hono) {
    const createSession = vi.fn(async (_request, principalId: string) => ({ principalId }));
    registerAuthenticatedLazyRouteFallback(app, {
      service: { voiceRealtime: { createSession } },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
    return createSession;
  }

  const request = (token?: string) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ purpose: 'dictation' }),
  });

  it('preserves the authenticated owner across lazy dispatch', async () => {
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-token', allowTailscale: false }) }));
    const createSession = mount(app);
    const response = await app.request('/api/voice/realtime/sessions', request('test-token'));
    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith({ purpose: 'dictation' }, 'gateway-owner');
  });

  it.each(['sessions', 'preflight'])('does not bypass authentication for %s', async (action) => {
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-token', allowTailscale: false }) }));
    const createSession = mount(app);
    expect((await app.request(`/api/voice/realtime/${action}`, request())).status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('does not mix concurrent request identities in the cached sub-app', async () => {
    const app = new Hono();
    let count = 0;
    app.use(async (c, next) => {
      setGatewayPrincipal(c, { kind: 'device', principalId: `device-${++count}`, scopes: ['gateway.admin'] });
      await next();
    });
    const createSession = mount(app);
    const responses = await Promise.all([1, 2].map(() => app.request('/api/voice/realtime/sessions', request())));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(createSession.mock.calls.map((call) => call[1]).sort()).toEqual(['device-1', 'device-2']);
  });
  it('preflights without creating a call', async () => {
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-token', allowTailscale: false }) }));
    const createSession = vi.fn();
    const preflight = vi.fn(async () => {});
    registerAuthenticatedLazyRouteFallback(app, {
      service: { voiceRealtime: { createSession, preflight } },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
    expect((await app.request('/api/voice/realtime/preflight', request('test-token'))).status).toBe(200);
    expect(preflight).toHaveBeenCalledWith({ purpose: 'dictation' });
    expect(createSession).not.toHaveBeenCalled();

  });

});
