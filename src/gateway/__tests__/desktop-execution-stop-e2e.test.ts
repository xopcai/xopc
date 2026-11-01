import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { expect, it, vi } from 'vitest';

import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { ConfigSchema } from '../../config/schema.js';
import { createDevice, getDevice, revokeDevice } from '../../storage/sqlite/device-access-repository.js';
import { getDesktopExecutionGrant, setDesktopExecutionGrant } from '../../storage/sqlite/desktop-execution-repository.js';
import { hasVerifiedDesktopExecutionStop } from '../../storage/sqlite/desktop-execution-stop-repository.js';
import { getOrCreateGatewayIdentity } from '../../storage/sqlite/gateway-identity-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('authenticates purpose-limited native stop signatures through real HTTP, including lost replies and revoked device identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-stop-proof-http-')); let passed = false;
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') });
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const disconnected = vi.fn();
  const service = { currentConfig: config, getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null, realtime: { disconnectPrincipal: disconnected },
  } as unknown as GatewayService;
  const app = createHonoApp({ service }); let loseReply = true, tamperReply = false;
  const paths: string[] = [];
  const server = serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
    paths.push(new URL(request.url).pathname);
    if (new URL(request.url).pathname === '/api/device-auth/execution-stops') expect(request.headers.has('authorization')).toBe(false);
    const response = await app.fetch(request);
    if (response.ok && new URL(request.url).pathname === '/api/device-auth/execution-stops') {
      if (loseReply) { loseReply = false; return new Response('{}', { status: 503 }); }
      if (tamperReply) { const body = await response.json(); body.signature = 'a'.repeat(86); return Response.json(body); }
    }
    return response;
  } });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`, gateway = getOrCreateGatewayIdentity(); config.gateway.corsOrigins = [origin];
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const device = createDevice({ displayName: 'Stop HTTP fixture', platform: 'desktop', scopes: ['gateway.status', 'device.self'], publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) });
    const binding = { profileId: randomUUID(), gatewayId: gateway.id, publicKey: gateway.publicKey, origin };
    const store = { load: async () => ({ deviceId: device.id, phase: 'revoked', privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }),
      serialize: async (_binding: unknown, work: () => unknown) => work() };
    const auth = new DesktopDeviceAuth(binding, store as never, async (path, method, body) => {
      const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    });
    const toolRevision = endpointToolRevision(REMOTE_BROWSER_DESCRIPTOR as never);
    const grant = (expectedRevision: number) => setDesktopExecutionGrant(device.id, expectedRevision, { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 120000,
      toolRevisions: { [REMOTE_BROWSER_DESCRIPTOR.name]: toolRevision } });
    const first = grant(0);
    const makeStop = (value: ReturnType<typeof grant>) => auth.signExecutionStop({ version: 1, stopId: randomUUID(), deviceId: device.id,
      gatewayId: gateway.id, grantId: value.grant!.grantId, authorizationRevision: value.revision, leaseGeneration: randomUUID(), executionStopped: true });
    const signed = await makeStop(first), scope = { gatewayId: gateway.id, deviceId: device.id, authorizationRevision: first.revision, tool: REMOTE_BROWSER_DESCRIPTOR.name, toolRevision };
    await expect(auth.submitExecutionStop(signed)).rejects.toThrow('UNAVAILABLE');
    expect(hasVerifiedDesktopExecutionStop(scope)).toBe(true); expect(getDesktopExecutionGrant(device.id)?.active).toBe(false); expect(disconnected).toHaveBeenCalledOnce();
    await auth.submitExecutionStop(signed); expect(disconnected).toHaveBeenCalledOnce();
    const next = grant(getDesktopExecutionGrant(device.id)!.revision);
    await auth.submitExecutionStop(signed); expect(getDesktopExecutionGrant(device.id)?.active).toBe(true);
    const nextSigned = await makeStop(next); revokeDevice(device.id); await auth.submitExecutionStop(nextSigned);
    expect(getDevice(device.id)?.revokedAt).toBeDefined(); expect(getDesktopExecutionGrant(device.id)).toBeUndefined();
    expect(paths).not.toContain('/api/device-auth/refresh');
    tamperReply = true; await expect(auth.submitExecutionStop(signed)).rejects.toThrow('RESPONSE_INVALID'); tamperReply = false;
    const post = (path: string, body: unknown) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/api/device-auth/execution-stops', { signed: { ...signed, signature: 'a'.repeat(86) }, nonce: 'n'.repeat(32) })).status).toBe(403);
    expect((await post('/api/device-auth/execution-stops', { signed, nonce: 'n'.repeat(32), extra: true })).status).toBe(400);
    expect((await post('/api/device-auth/execution-stops', { padding: 'x'.repeat(3000) })).status).toBe(413);
    expect((await post('/api/device-auth/execution-stops/extra', {})).status).toBe(401);
    expect((await post('/api/desktop-host/execution', {})).status).toBe(401);
    passed = true;
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (passed) await rm(root, { recursive: true, force: true }); else console.error(`Stop proof HTTP failure retained: ${root}`);
  }
}, 30000);
