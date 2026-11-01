import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { startEndpointToolInvocationAudit } from '../../storage/sqlite/endpoint-tool-invocation-repository.js';
import { createDevice, getDevice, issueDeviceTokenPair } from '../../storage/sqlite/device-access-repository.js';
import { getOrCreateGatewayIdentity } from '../../storage/sqlite/gateway-identity-repository.js';
import { proofDigest, requestProofMessage } from '../security/device-request-proof.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('queries transport attempts by stable operation through the real authenticated Gateway route without leaking argument bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-operation-audit-http-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'gateway.db') });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(directory, 'files') }), realtime = new RealtimeRuntime(endpoints);
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const service = { currentConfig: config, endpointTools: endpoints, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }), server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`, operationId = randomUUID(), otherOperationId = randomUUID();
    for (const index of [0, 1, 2]) startEndpointToolInvocationAudit({ id: randomUUID(), operationId: index < 2 ? operationId : otherOperationId,
      principalId: index < 2 ? 'fixture-device' : 'other-device', endpointId: 'fixture-endpoint', toolCallId: 'fixture', toolName: 'desktop.file.save',
      effect: 'write', confirmationRequired: true, argumentsSha256: 'a'.repeat(64), startedAt: Date.now() });
    const route = origin + '/api/endpoint-tools/invocations';
    expect((await fetch(route)).status).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    const filtered = await fetch(route + '?operationId=' + operationId, { headers }); expect(filtered.status).toBe(200);
    const data = await filtered.json(); expect(data.payload.total).toBe(2);
    expect(data.payload.items.every((row: any) => row.operationId === operationId && !('arguments' in row))).toBe(true);
    expect((await (await fetch(route, { headers })).json()).payload.total).toBe(3);
    for (const invalid of ['', 'not-an-operation', '../another']) expect((await fetch(route + '?operationId=' + encodeURIComponent(invalid), { headers })).status).toBe(400);
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const device = createDevice({ id: 'fixture-device', displayName: 'Own audit fixture', platform: 'android', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) as any, scopes: ['device.self'] });
    const credential = issueDeviceTokenPair(device.id).accessToken;
    const deviceRequest = async (target: string, method = 'GET', body?: unknown) => {
      const json = body === undefined ? undefined : JSON.stringify(body);
      const contentType = json === undefined ? undefined : 'application/json';
      const proof = { timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), digest: proofDigest(json ?? '') };
      const payload = requestProofMessage({ gatewayId: getOrCreateGatewayIdentity().id, credential, method, target,
        headers: name => name === 'content-type' ? contentType : undefined, proof });
      const signature = sign('sha256', Buffer.from(payload), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return fetch(origin + target, { method, body: json, headers: { authorization: `Bearer ${credential}`,
        ...(contentType ? { 'content-type': contentType } : {}), 'X-Xopc-Proof': `${proof.timestamp}.${proof.nonce}.${proof.digest}.${signature}` } });
    };
    const deviceGet = (query = '') => deviceRequest('/api/endpoint-tools/invocations' + query);
    const own = await deviceGet(); expect(own.status).toBe(200); expect((await own.json()).payload.total).toBe(2);
    const other = await deviceGet('?operationId=' + otherOperationId); expect(other.status).toBe(200); expect((await other.json()).payload.total).toBe(0);
    expect((await deviceGet('?principalId=other-device')).status).toBe(403);
    expect((await deviceRequest('/api/endpoint-tools/devices/revoke', 'POST', { ids: [device.id] })).status).toBe(403);
    expect(getDevice(device.id)?.revokedAt).toBeUndefined();
  } finally {
    realtime.close(); endpoints.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
