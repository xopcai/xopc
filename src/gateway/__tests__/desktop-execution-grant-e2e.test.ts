import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { DesktopDeviceAuth, type DesktopAuthTransport } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('authenticates and signs exact device grant transitions, rejects stale cleanup and keeps revoked observation separate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-execution-grant-http-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'gateway.db') });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(directory, 'files') }), realtime = new RealtimeRuntime(endpoints);
  const disconnect = vi.spyOn(realtime, 'disconnectPrincipal');
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const service = { currentConfig: config, endpointTools: endpoints, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }), server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  let channel: ReturnType<typeof desktopAuthTransport> | undefined;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const owner = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBeLessThan(300); return response.json();
    };
    const identity = (await owner('/api/desktop-host/compatibility')).payload;
    const binding = { profileId: randomUUID(), origin, gatewayId: identity.gatewayId, publicKey: identity.publicKey };
    // Encryption/consent are fixture injections. This verifies real HTTP auth, not native execution approval.
    const store = new DesktopIdentityStore(join(directory, 'identity'), { available: async () => true, encrypt: async value => Buffer.from(value), decrypt: async bytes => bytes.toString() });
    channel = desktopAuthTransport(binding, 'ssh'); let status = 0, tamper = false, replay = false, lastResponse: any;
    const transport: DesktopAuthTransport = async (...args) => {
      const response = await channel!.request(...args);
      if (args[0] !== '/api/desktop-host/execution') return response;
      status = response.status;
      if (replay && lastResponse) return structuredClone(lastResponse);
      lastResponse = structuredClone(response);
      if (tamper && response.status === 200) response.body.payload.revision += 1;
      return response;
    };
    const auth = new DesktopDeviceAuth(binding, store, transport);
    const { deviceId } = await auth.enroll({ displayName: 'Execution fixture', consent: async () => true,
      setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).payload.invitation,
      approve: async (id, revision) => { await owner(`/api/device-pairing/requests/${id}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); } });
    expect(await auth.endpointRequest('/api/desktop-host/execution', 'GET')).toMatchObject({ active: false, revision: 0 });
    expect(getDevice(deviceId)?.scopes).toEqual(['gateway.status', 'device.self']);
    const proposal = { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), toolRevisions: { 'desktop.clipboard.write': 'a'.repeat(64) }, expiresAt: Date.now() + 60000 };
    const forbidden = await fetch(origin + '/api/desktop-host/execution', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, grant: proposal }) });
    expect(forbidden.status).toBe(403);
    const granted = await auth.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: 0, grant: proposal });
    expect(granted).toMatchObject({ active: true, revision: 1, grant: proposal });
    const calls = disconnect.mock.calls.length;
    expect(await auth.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: 0, grant: proposal })).toEqual(granted);
    expect(disconnect).toHaveBeenCalledTimes(calls);
    await auth.endpointRequest('/api/desktop-host/observation', 'DELETE');
    expect(disconnect).toHaveBeenCalledTimes(calls); expect(getDevice(deviceId)?.scopes).toContain('desktop.execute');
    const observation = (await owner(`/api/desktop-host/devices/${deviceId}/observation`)).payload;
    await owner(`/api/desktop-host/devices/${deviceId}/observation`, 'POST', { state: true, expectedRevision: observation.revision });
    const afterObservation = disconnect.mock.calls.length;
    expect(await auth.endpointRequest('/api/desktop-host/execution', 'DELETE', { grantId: proposal.grantId, expectedRevision: 1 })).toMatchObject({ active: false, revision: 2 });
    expect(disconnect).toHaveBeenCalledTimes(afterObservation);
    await expect(auth.endpointRequest('/api/desktop-host/observation', 'DELETE', { expectedRevision: observation.revision })).rejects.toThrow();
    expect(getDevice(deviceId)?.scopes).toContain('desktop.observe.state');
    const next = { ...proposal, grantId: randomUUID(), localApprovalId: randomUUID() };
    expect(await auth.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: 2, grant: next })).toMatchObject({ active: true, revision: 3 });
    await expect(auth.endpointRequest('/api/desktop-host/execution', 'DELETE', { grantId: proposal.grantId, expectedRevision: 1 })).rejects.toThrow(); expect(status).toBe(409);
    expect(getDevice(deviceId)?.scopes).toContain('desktop.execute');
    tamper = true; await expect(auth.endpointRequest('/api/desktop-host/execution', 'GET')).rejects.toThrow('AUTHORITY_RESPONSE_INVALID');
    tamper = false; await auth.endpointRequest('/api/desktop-host/execution', 'GET');
    replay = true; await expect(auth.endpointRequest('/api/desktop-host/execution', 'GET')).rejects.toThrow('AUTHORITY_RESPONSE_INVALID');
    replay = false;
    expect(await auth.endpointRequest('/api/desktop-host/execution', 'DELETE', { grantId: next.grantId, expectedRevision: 3 })).toMatchObject({ active: false, revision: 4 });
    expect(getDevice(deviceId)?.scopes).toEqual(['gateway.status', 'device.self']);
  } finally {
    channel?.close(); realtime.close(); endpoints.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
