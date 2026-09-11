import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { auth } from '../../middleware/auth.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';

describe('authenticated lazy voice context', () => {
  afterEach(() => resetLazyRouteBundlesForTests());

  function mount(app: Hono) {
    const createSession = vi.fn(async (_request, principalId: string) => ({ principalId }));
    const cancelSession = vi.fn(() => true);
    registerAuthenticatedLazyRouteFallback(app, {
      service: { voiceRealtime: { createSession, cancelSession } },
      strictRateLimitMiddleware: async (_c, next) => next(),
    } as never);
    return { createSession, cancelSession };
  }

  const request = (token?: string) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ purpose: 'dictation', supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] }),
  });

  it('preserves the authenticated owner across lazy dispatch', async () => {
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-token', allowTailscale: false }) }));
    const { createSession } = mount(app);
    const response = await app.request('/api/voice/realtime/sessions', request('test-token'));
    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith({ purpose: 'dictation', supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] }, 'gateway-owner');
  });

  it.each(['sessions', 'preflight', 'sessions/cancel'])('does not bypass authentication for %s', async (action) => {
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-token', allowTailscale: false }) }));
    const { createSession } = mount(app);
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
    const { createSession } = mount(app);
    const responses = await Promise.all([1, 2].map(() => app.request('/api/voice/realtime/sessions', request())));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(createSession.mock.calls.map((call) => call[1]).sort()).toEqual(['device-1', 'device-2']);
  });

  it('cancels an unused ticket as the authenticated owner', async () => {
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-token', allowTailscale: false }) }));
    const { cancelSession } = mount(app);
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    const ticket = 'x'.repeat(32);
    const response = await app.request('/api/voice/realtime/sessions/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ sessionId, ticket }),
    });
    expect(response.status).toBe(200);
    expect(cancelSession).toHaveBeenCalledWith(sessionId, ticket, 'gateway-owner');
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
    expect(preflight).toHaveBeenCalledWith({ purpose: 'dictation', supportedProtocolVersions: [3], mediaPreferences: ['websocket-pcm'] });
    expect(createSession).not.toHaveBeenCalled();

  });

});
