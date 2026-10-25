import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { EndpointContextStore } from '../../endpoint-tools/context-store.js';
import { EndpointRegistry } from '../../endpoint-tools/registry.js';
import { LocationSharingService } from '../../endpoint-tools/location-sharing.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

const phone = vi.hoisted(() => ({
  repository: { get: vi.fn(() => ({ enabled: true, connection: { kind: 'aliyun-adb' } })) },
  environment: { apply: vi.fn(async () => {}), clear: vi.fn(async () => true), status: vi.fn(() => ({ status: 'clean' })) },
}));
vi.mock('../../phone/runtime.js', async importOriginal => ({ ...await importOriginal<object>(), getPhoneRuntime: () => phone }));

it('serves authenticated environment reports through the real lazy-loaded Gateway path', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-context-http-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') });
  const registry = new EndpointRegistry();
  const contexts = new EndpointContextStore(registry);
  const locations = new LocationSharingService(registry, contexts);
  const hello = { principalId: 'device', endpointId: 'phone', connectionInstanceId: 'instance', displayName: 'Phone',
    kind: 'mobile' as const, platform: 'android', appVersion: '1', availability: 'foreground' as const,
    nonce: 'nonce', signedAt: Date.now(), signature: 'signature', tools: [] };
  const registration = registry.register(hello, 'epoch', { readyState: 1, send() {}, close() {} });
  const token = 'context-http-owner-token';
  const service = { currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } }, phone: { enabled: true } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null, endpointTools: { registry, contexts, locations },
    sessions: { getSession: async () => ({ agentId: 'main' }) },
    emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const root = `http://127.0.0.1:${address.port}/api/user-context/environment`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    expect((await fetch(root)).status).toBe(401);
    expect((await fetch(`${root}/endpoints/phone`, { headers })).status).toBe(200);
    const origin = { type: 'endpoint', endpointId: 'phone', token: registration.turnToken };
    const post = (action: string, body: unknown) => fetch(`${root}/${action}`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await post('heartbeats', { origin, heartbeat: { connectionEpoch: 'epoch', sequence: 1, availability: 'foreground' } })).status).toBe(200);
    const report = { version: 1, reportId: 'report', connectionEpoch: 'epoch', sequence: 1,
      baseRevision: null, mode: 'full', capturedAt: Date.now(), values: { 'environment.timezone': 'Asia/Shanghai', 'environment.locale': 'zh-CN' } };
    const response = await post('reports', { origin, report });
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()).payload.revision).toBe(1);
    const snapshot = await (await fetch(root, { headers })).json();
    expect(snapshot.payload[0].fields['environment.timezone']).toMatchObject({ status: 'fresh', value: 'Asia/Shanghai' });
    expect(JSON.stringify(snapshot)).not.toContain(registration.turnToken);
    expect((await post('reports', { origin: { ...origin, token: 'wrong'.repeat(8) }, report })).status).toBe(409);
    expect((await post('reports', { origin, report: { ...report, reportId: 'invalid', sequence: 2, values: { 'physical.location': { latitude: 1 } } } })).status).toBe(400);
    expect((await post('reports', { origin, report, padding: 'x'.repeat(17_000) })).status).toBe(413);
    const conversationId = randomUUID(); const phoneId = randomUUID();
    const request = { conversationId, phoneId, precision: 'precise', mode: 'while_in_use', durationMs: 60_000 };
    expect((await post('location-shares', { origin, request })).status).toBe(400);
    const created = await post('location-shares', { origin, request, disclosureVersion: 'location-sharing-v1' });
    expect(created.status, await created.clone().text()).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const share = (await created.json()).payload;
    expect((await post(`location-shares/${share.id}/samples`, { padding: 'x'.repeat(5000) })).status).toBe(413);
    const sample = { latitude: 31.234567, longitude: 121.345678, capturedAt: Date.now(), accuracyMeters: 10,
      precision: 'precise', coordinateSystem: 'WGS84' };
    expect((await post(`location-shares/${share.id}/samples`, { origin: { ...origin, token: 'incorrect-token'.repeat(4) }, sequence: 1, sample })).status).toBe(403);
    const applied = await post(`location-shares/${share.id}/samples`, { origin, sequence: 1, sample });
    expect(applied.status, await applied.clone().text()).toBe(200);
    expect(phone.environment.apply).toHaveBeenCalledOnce();
    expect(await applied.text()).not.toContain(String(sample.latitude));
    expect((await post(`location-shares/${share.id}/samples`, { origin, sequence: 1, sample })).status).toBe(409);
    expect((await fetch(`${root}/location-shares?endpointId=someone-else`, { headers })).status).toBe(403);
    const revoked = await fetch(`${root}/location-shares/${share.id}`, { method: 'DELETE', headers, body: JSON.stringify({ origin }) });
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    expect((await revoked.json()).payload).toMatchObject({ status: 'revoked', sync: 'clean' });
    expect(phone.environment.clear).toHaveBeenCalledWith(share.id, phoneId);
    const environmentUrl = `http://127.0.0.1:${address.port}/api/phone/devices/${phoneId}/environment`;
    expect((await fetch(environmentUrl)).status).toBe(401);
    expect((await fetch(environmentUrl, { headers })).status).toBe(200);
    const cleaned = await fetch(`${environmentUrl}/cleanup`, { method: 'POST', headers });
    expect(cleaned.status, await cleaned.clone().text()).toBe(200);
    expect((await cleaned.json()).payload).toMatchObject({ cleared: true, status: 'clean' });
    registry.disconnect('phone');
    expect((await fetch(`${root}/endpoints/phone`, { headers })).status).toBe(409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await locations.close(); contexts.close(); registry.closeAll(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  }
});
