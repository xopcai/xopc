import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { registerRealtimeRoutes } from '../realtime.js';

function createApp() {
  const issue = vi.fn(() => ({ ticket: 'x'.repeat(43) }));
  const app = new Hono();
  app.use('*', async (c, next) => {
    setGatewayPrincipal(c, {
      kind: 'device',
      principalId: 'phone',
      deviceId: 'phone',
      scopes: ['gateway.status'],
    });
    await next();
  });
  registerRealtimeRoutes(app, {
    service: { realtime: { tickets: { issue } } },
  } as unknown as AuthenticatedRouteDeps);
  return { app, issue };
}

function ticketBody(protocolVersion: number) {
  return JSON.stringify({ clientId: 'mobile:phone', clientKind: 'mobile', protocolVersion });
}

describe('realtime ticket compatibility', () => {
  it('requires clients to declare a protocol version', async () => {
    const { app, issue } = createApp();
    const response = await app.request('/api/realtime/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'mobile:phone', clientKind: 'mobile' }),
    });

    expect(response.status).toBe(400);
    expect(issue).not.toHaveBeenCalled();
  });

  it.each([
    [REALTIME_PROTOCOL_VERSION - 1, 'CLIENT_UPDATE_REQUIRED'],
    [REALTIME_PROTOCOL_VERSION + 1, 'GATEWAY_UPDATE_REQUIRED'],
  ])('returns a non-retryable directed error for protocol %s', async (protocolVersion, code) => {
    const { app, issue } = createApp();
    const response = await app.request('/api/realtime/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ticketBody(protocolVersion),
    });

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code,
        retryable: false,
        clientProtocolVersion: protocolVersion,
        gatewayProtocolVersion: REALTIME_PROTOCOL_VERSION,
      },
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it('issues a ticket when protocol versions match', async () => {
    const { app, issue } = createApp();
    const response = await app.request('/api/realtime/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ticketBody(REALTIME_PROTOCOL_VERSION),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      payload: {
        ticket: expect.any(String),
        realtime: {
          minVersion: REALTIME_PROTOCOL_VERSION,
          maxVersion: REALTIME_PROTOCOL_VERSION,
        },
      },
    });
    expect(issue).toHaveBeenCalledOnce();
  });
});
