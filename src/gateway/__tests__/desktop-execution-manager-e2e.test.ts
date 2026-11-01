import { createHash, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { canonicalJson, endpointHelloSigningPayload, ENDPOINT_TEXT_OUTPUT_SCHEMA, type EndpointToolDescriptor, type ClientEndpointMessage } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { DesktopExecutionHost } from '../../../electron/desktop/execution-host.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../../../electron/desktop/operation-journal.js';
import { DesktopOperationSupervisor } from '../../../electron/desktop/operation-supervisor.js';
import { DesktopExecutionSession } from '../../../electron/desktop/execution-session.js';
import { DesktopExecutionCatalog } from '../../../electron/desktop/execution-catalog.js';
import { DesktopReliableToolController } from '../../../electron/desktop/reliable-tool-controller.js';
import { executeExternalOperation } from '../../capabilities/runtime/external-operations.js';
import { endpointToolRevision } from '../../endpoint-tools/registry.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ConfigSchema } from '../../config/schema.js';
import { DesktopDeviceFrameSigner } from '../../endpoint-tools/desktop-device-frame.js';
import { verifyDesktopGatewayFrame } from '../../endpoint-tools/desktop-frame.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice, setDesktopStateObservation } from '../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

import { DesktopExecutionManager } from '../../../electron/desktop/execution-manager.js';
import { GatewayConnectionPreview } from '../../../electron/gateway/connection-manager.js';
import { ConnectionProfileStore } from '../../../electron/gateway/profiles.js';
import { ConnectionCredentialStore } from '../../../electron/gateway/credentials.js';
it('stops pending approval and revokes the exact grant on epoch change without taking over another executor', async () => {
  const legacyFrames = false;
  const directory = await mkdtemp(join(tmpdir(), 'xopc-desktop-observation-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'gateway.db') });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(directory, 'files') });
  const realtime = new RealtimeRuntime(endpoints, id => getDevice(id)?.revokedAt === undefined);
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const service = { currentConfig: config, endpointTools: endpoints, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }), server = serve({ fetch: async (request, ...args) => {
    const response = await app.fetch(request, ...args);
    if (legacyFrames && new URL(request.url).pathname === '/api/desktop-host/compatibility') {
      const value = await response.json(); delete value.payload.capabilities.signedDeviceFrames;
      return Response.json(value, { status: response.status, headers: response.headers });
    }
    return response;
  }, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  let execution: DesktopExecutionManager | undefined,  channel: ReturnType<typeof desktopAuthTransport> | undefined;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const owner = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBeLessThan(300); return response.json();
    };
    // Fixture encryption and consent are injected. OS safeStorage/native approval are separate installation E2Es.
    const encryption = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (bytes: Buffer) => bytes.toString() };
    const manager = new GatewayConnectionPreview(new ConnectionProfileStore(join(directory, 'connections')), new ConnectionCredentialStore(join(directory, 'credentials'), encryption));
    await manager.initialize(); const saved = await manager.save(0, { name: 'Observation fixture', origin, transport: 'ssh', credential: token });
    const id = saved.profiles[0].id; await manager.select(saved.epoch, id);
    const identity = (await owner('/api/desktop-host/compatibility')).payload;
    await manager.pinIdentity(manager.snapshot().epoch, id, { gatewayId: identity.gatewayId, publicKey: identity.publicKey });
    const binding = { profileId: id, origin, gatewayId: identity.gatewayId, publicKey: identity.publicKey };
    const store = new DesktopIdentityStore(join(directory, 'identities'), encryption);
    channel = desktopAuthTransport(binding, 'ssh'); const client = new DesktopDeviceAuth(binding, store, channel.request);
    const { deviceId } = await client.enroll({ displayName: 'State-only desktop', consent: async () => true,
      setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).payload.invitation,
      approve: async (requestId, revision) => { await owner(`/api/device-pairing/requests/${requestId}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); },
    });
    await expect(client.endpointRequest('/api/realtime/tickets', 'POST', { clientId: randomUUID(), clientKind: 'desktop', protocolVersion: 2 })).rejects.toThrow('DESKTOP_OBSERVATION_DENIED');
    const descriptor: EndpointToolDescriptor = { name: 'desktop.clipboard.write', title: 'Fixture', description: 'Fixture only', inputSchema: { type: 'object' }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: 'user.foreground-write', sensitivity: 'personal', effect: 'write', confirmation: 'always', requiresForeground: true,
      requiredPermissions: ['clipboard-write'], timeoutMs: 10000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: ['text'] };
    let allowed = false, pending: ReturnType<typeof Promise.withResolvers<boolean>> | undefined, consentCount = 0, effects = 0;
    const executorRoot = join(directory, 'executor');
    execution = new DesktopExecutionManager({ manager, store, executorRoot, catalog: new DesktopExecutionCatalog([descriptor]), appVersion: 'fixture', foreground: () => true,
      consent: async () => { consentCount += 1; return pending ? pending.promise : allowed; }, confirm: async () => true,
      createWorker: () => ({ run: async () => { effects += 1; return { status: 'succeeded', result: { content: [{ type: 'text', text: 'fixture' }] } }; }, stop: async () => ({ confirmed: true }) }) });
    await expect(execution.start(manager.snapshot().epoch, id)).rejects.toThrow('CONSENT_DENIED');
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute');
    const count = consentCount;
    await expect(execution.start(manager.snapshot().epoch - 1, id)).rejects.toThrow('STALE_CONNECTION_EPOCH'); expect(consentCount).toBe(count);
    pending = Promise.withResolvers<boolean>();
    const started = execution.start(manager.snapshot().epoch, id), rejected = expect(started).rejects.toThrow('CANCELLED');
    await vi.waitFor(() => expect(consentCount).toBe(count + 1));
    await execution.requireStopped(); pending.resolve(true); await rejected; pending = undefined;
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute');
    allowed = true; await execution.start(manager.snapshot().epoch, id);
    await vi.waitFor(() => expect(execution!.origin()).toBeDefined());
    expect(getDevice(deviceId)?.scopes).toContain('desktop.execute'); expect(await execution.readyOrigin()).toBeDefined();
    await expect(execution.start(manager.snapshot().epoch, id)).rejects.toThrow('BUSY');
    await manager.select(manager.snapshot().epoch, id);
    await vi.waitFor(() => expect(execution!.snapshot()).toMatchObject({ state: 'stopped', remoteRevocationConfirmed: true }));
    expect(execution.origin()).toBeUndefined(); expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute'); expect(effects).toBe(0);
    const lease = new DesktopExecutionLease(executorRoot); lease.close();
  } finally {
    await execution?.requireStopped(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
