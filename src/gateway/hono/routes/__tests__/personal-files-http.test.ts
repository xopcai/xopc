import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { personalDescriptor } from '@xopcai/endpoint-tools-protocol';

import { EndpointToolRuntime } from '../../../../endpoint-tools/runtime.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import { findAuthenticatedLazyRouteBundle } from '../lazy-bundles.js';
import { registerEndpointToolRoutes } from '../endpoint-tools.js';
import type { AuthenticatedRouteDeps } from '../deps.js';

it('serves compatibility and device-owned files over authenticated HTTP; rejects foreign reads and uploads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xopc-personal-http-'));
  const runtime = new EndpointToolRuntime({ uploadRoot: root, audit: { started: vi.fn(), finished: vi.fn() } });
  runtime.registry.register({ principalId: 'phone-owner', endpointId: 'phone', connectionInstanceId: randomUUID(), displayName: 'Phone',
    kind: 'mobile', platform: 'android', appVersion: '1', availability: 'foreground', nonce: randomUUID(), signedAt: Date.now(),
    signature: 'fixture-signature', tools: [personalDescriptor('mobile.file.pick')] }, 'connection', { readyState: 1, send: () => {}, close: () => {} });
  const app = new Hono();
  const ownToken = randomUUID(), foreignToken = randomUUID();
  app.use('*', async (c, next) => {
    const token = c.req.header('Authorization');
    if (token !== `Bearer ${ownToken}` && token !== `Bearer ${foreignToken}`) return c.json({ error: 'unauthorized' }, 401);
    const deviceId = token === `Bearer ${ownToken}` ? 'phone-owner' : 'other-phone';
    setGatewayPrincipal(c, { kind: 'device', principalId: deviceId, deviceId, scopes: ['gateway.chat'] });
    await next();
  });
  const deps = { service: { endpointTools: runtime } } as AuthenticatedRouteDeps;
  registerEndpointToolRoutes(app, deps);
  const bundle = findAuthenticatedLazyRouteBundle('/api/endpoint-tools/compatibility');
  (await bundle!.load()).register(app, deps);
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP address');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    expect((await fetch(`${origin}/api/endpoint-tools/compatibility`)).status).toBe(401);
    const compatibility = await fetch(`${origin}/api/endpoint-tools/compatibility`, { headers: { Authorization: `Bearer ${ownToken}` } });
    expect(await compatibility.json()).toMatchObject({ payload: { mobilePersonalToolsV1: true } });
    const grant = runtime.uploads.createGrant('fixture', 'phone', Date.now(), 'personal', 'phone-owner');
    const headers = { Authorization: `Bearer ${ownToken}`, 'x-endpoint-id': 'phone', 'x-endpoint-upload-token': grant.token, 'Content-Type': 'text/plain' };
    const path = `${origin}${grant.path}?name=fixture.txt`;
    expect((await fetch(path, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${foreignToken}` }, body: 'private' })).status).toBe(403);
    const uploaded = await fetch(path, { method: 'POST', headers, body: 'selected document' });
    expect(uploaded.status).toBe(201);
    const file = (await uploaded.json()).payload;
    const ownFile = await fetch(`${origin}/api/endpoint-tools/files/${file.fileId}`, { headers: { Authorization: `Bearer ${ownToken}` } });
    expect(ownFile.status).toBe(200); expect(await ownFile.text()).toBe('selected document');
    expect((await fetch(`${origin}/api/endpoint-tools/files/${file.fileId}`, { headers: { Authorization: `Bearer ${foreignToken}` } })).status).toBe(403);
    runtime.uploads.abort('fixture');
    expect((await fetch(path, { method: 'POST', headers, body: 'late document' })).status).toBe(400);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); runtime.close(); rmSync(root, { recursive: true, force: true });
  }
});
