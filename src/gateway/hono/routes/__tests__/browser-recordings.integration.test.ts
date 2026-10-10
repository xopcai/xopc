import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { useTestDatabase } from '../../../../storage/sqlite/__tests__/test-database.js';
import { createDevice, issueDeviceTokenPair } from '../../../../storage/sqlite/device-access-repository.js';
import { BrowserAutomationService } from '../../../../browser/automations/service.js';
import { auth } from '../../middleware/auth.js';
import { gatewayScopes } from '../../middleware/scopes.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';
import type { AuthenticatedRouteDeps } from '../deps.js';

useTestDatabase();
it('serves recording ingestion, verification and runs over authenticated HTTP through lazy bundles', async () => {
  resetLazyRouteBundlesForTests();
  const browser = new BrowserAutomationService(async () => ({ ok: true, result: { url: 'https://example.com' }, businessOutcome: 'completed' }));
  createDevice({ id: 'chrome-device', displayName: 'Chrome', platform: 'chrome', extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', scopes: ['device.self'],
    publicKeyJwk: generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' }) });
  const tokens = issueDeviceTokenPair('chrome-device');
  const app = new Hono();
  let endpoints: Array<{ endpointId: string; displayName: string; principalId: string; kind: string; tools: Array<{ descriptor: { name: string } }> }> = [];
  const invoke = vi.fn(async () => ({ content: [{ type: 'json', value: { id: 'recording', state: 'recording' } }] }));
  app.use('*', auth({ getResolvedAuth: () => ({ mode: 'token', token: 'test-owner' }) }));
  app.use('*', gatewayScopes());
  registerAuthenticatedLazyRouteFallback(app, {
    service: { browserAutomations: browser, endpointTools: { registry: {
      list: () => endpoints,
      getTool: () => ({ revision: 'revision' }),
      get: (id: string) => id === 'chrome' ? { principalId: 'chrome-device' } : undefined,
      verifyTurnClaim: (id: string, claim: string) => id === 'chrome' && claim === 'current-claim',
    }, invocations: { invoke } } }, strictRateLimitMiddleware: async (_c, next) => next(),
  } as unknown as AuthenticatedRouteDeps);
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, token?: string, claim = 'current-claim') => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), 'x-endpoint-id': 'chrome', 'x-endpoint-claim': claim }, body: JSON.stringify(body) });
  try {
    const availability = async (token = 'test-owner') => (await fetch(`${base}/api/browser/recordings/availability`, { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(await availability()).toEqual({ state: 'connect_required', endpoints: [] });
    const disconnected = await post('/api/browser/recordings/control', { operation: 'start' }, 'test-owner');
    expect(disconnected.status).toBe(409);
    expect((await disconnected.json()).code).toBe('connect_required');
    expect(invoke).not.toHaveBeenCalled();
    endpoints = [{ endpointId: 'chrome', displayName: 'My Chrome', principalId: 'chrome-device', kind: 'browser', tools: [{ descriptor: { name: 'browser.control' } }] }];
    expect((await availability()).state).toBe('update_required');
    expect((await (await post('/api/browser/recordings/control', { operation: 'start' }, 'test-owner')).json()).code).toBe('update_required');
    endpoints[0]!.tools.push({ descriptor: { name: 'browser.recording' } });
    expect(await availability()).toEqual({ state: 'ready', endpoints: [{ endpointId: 'chrome', displayName: 'My Chrome' }] });
    endpoints.push({ ...endpoints[0]!, endpointId: 'another-chrome', displayName: 'Another Chrome', principalId: 'another-device' });
    expect((await availability()).state).toBe('choose_browser');
    expect((await availability(tokens.accessToken)).endpoints).toHaveLength(1);
    expect((await post('/api/browser/recordings/control', { operation: 'start', endpointId: 'chrome' }, 'test-owner')).status).toBe(200);
    expect(invoke).toHaveBeenCalledOnce();
    const id = randomUUID();
    const path = `/api/browser/recordings/${id}/events`;
    const body = { events: [{ id: randomUUID(), seq: 1, sourceSeq: 1, documentId: 'doc', action: 'navigate', url: 'https://example.com' }, { id: randomUUID(), seq: 2, sourceSeq: 2, documentId: 'doc', action: 'checkpoint', url: 'https://example.com' }] };
    expect((await post(path, body)).status).toBe(401);
    expect((await post(path, body, tokens.accessToken, 'stale-claim')).status).toBe(403);
    expect(await (await post(path, body, tokens.accessToken)).json()).toEqual({ ackThrough: 2 });
    const saved = await (await post(`/api/browser/recordings/${id}/finish`, { finalSeq: 2 }, tokens.accessToken)).json();
    expect(saved.automation.verified).toBe(false);
    expect(await (await post('/api/browser/automations/validate', { definition: saved.automation.definition }, 'test-owner')).json()).toEqual({ valid: true, issues: [] });
    const running = await post(`/api/browser/automations/${saved.automation.id}/test`, { inputs: {}, clientRequestId: 'run-once' }, 'test-owner');
    expect(running.status).toBe(202);
    const run = (await running.json()).run;
    const retry = await (await post(`/api/browser/automations/${saved.automation.id}/run`, { inputs: {}, clientRequestId: 'run-once' }, 'test-owner')).json();
    expect(retry.run.id).toBe(run.id);
    const versions = await fetch(`${base}/api/browser/automations/${saved.automation.id}/versions`, { headers: { Authorization: 'Bearer test-owner' } });
    expect(versions.status).toBe(200);
    expect((await versions.json()).versions).toHaveLength(1);
  } finally { await browser.shutdown(); await new Promise<void>((resolve) => server.close(() => resolve())); resetLazyRouteBundlesForTests(); }
});
