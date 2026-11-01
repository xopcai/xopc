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

it.each(['success', 'denied', 'lost-connection'] as const)('runs the separate execution Host against authenticated Gateway HTTP/WS: %s', async scenario => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-device-frame-e2e-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'gateway.db') });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(directory, 'files') });
  const realtime = new RealtimeRuntime(endpoints, id => getDevice(id)?.revokedAt === undefined);
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const service = { currentConfig: config, endpointTools: endpoints, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }), server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  let channel: ReturnType<typeof desktopAuthTransport> | undefined, socket: WebSocket | undefined, signer: DesktopDeviceFrameSigner | undefined;
  let host: DesktopExecutionHost | undefined;
  let lease: DesktopExecutionLease | undefined, journal: DesktopOperationJournal | undefined, controller: DesktopReliableToolController | undefined;
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
    // Isolated fixture storage/consent; OS safeStorage and native consent have separate package acceptance.
    const store = new DesktopIdentityStore(join(directory, 'identity'), { available: async () => true,
      encrypt: async value => Buffer.from(value), decrypt: async bytes => bytes.toString() });
    channel = desktopAuthTransport(binding, 'ssh'); const auth = new DesktopDeviceAuth(binding, store, channel.request);
    const { deviceId } = await auth.enroll({ displayName: 'Signed result fixture', consent: async () => true,
      setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).payload.invitation,
      approve: async (id, revision) => { await owner(`/api/device-pairing/requests/${id}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); } });
    const descriptor: EndpointToolDescriptor = { name: 'desktop.clipboard.write', title: 'Fixture', description: 'Fixture only', inputSchema: { type: 'object' }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: 'user.foreground-write', sensitivity: 'personal', effect: 'write', confirmation: 'always', requiresForeground: true,
      requiredPermissions: ['clipboard-write'], timeoutMs: 10000, maxConcurrency: 1, supportsCancellation: true, idempotent: false, resultKinds: ['text'] };
    const revision = endpointToolRevision(descriptor), expiresAt = Date.now() + 60000;
    const grant = await auth.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: 0, grant: {
      version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), toolRevisions: { 'desktop.clipboard.write': revision }, expiresAt } });
    lease = new DesktopExecutionLease(join(directory, 'journal')); journal = new DesktopOperationJournal(lease);
    let effects = 0, approvals = 0, stopped = 0, allowStop = false;
    const began = Promise.withResolvers<void>(), completion = Promise.withResolvers<{ status: 'succeeded'; result: { content: { type: 'text'; text: string }[] } }>();
    host = new DesktopExecutionHost({ binding, auth, appVersion: 'fixture', approved: grant.grant, authorizationRevision: grant.revision,
      catalog: new DesktopExecutionCatalog([descriptor]), journal, foreground: () => true, onState: () => {},
      confirm: async () => { approvals += 1; return scenario !== 'denied'; },
      createWorker: () => ({ run: async () => { effects += 1; began.resolve();
        return scenario === 'lost-connection' ? completion.promise : { status: 'succeeded', result: { content: [{ type: 'text', text: 'host result' }] } }; },
        stop: async () => { stopped += 1; return { confirmed: scenario !== 'lost-connection' || allowStop }; } }),
    });
    await host.start(); await vi.waitFor(() => expect(host!.origin()).toBeDefined());
    const endpointId = host.origin()!.endpointId;
    const args = { text: 'fixture' }, key = randomUUID();
    const invoke = () => executeExternalOperation({ principalId: deviceId, capabilityId: 'fixture', idempotencyKey: key,
      requestDigest: createHash('sha256').update(canonicalJson(args)).digest('hex'), descriptorDigest: revision, surface: 'fixture', recovery: 'manual' },
    operationId => endpoints.invocations.invoke({ endpointId, toolCallId: 'fixture', toolName: descriptor.name, descriptorRevision: revision, arguments: args, operationId }));
    const result = invoke();
    if (scenario === 'lost-connection') {
      const rejection = expect(result).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
      await began.promise;
      await auth.endpointRequest('/api/desktop-host/execution', 'DELETE', { grantId: grant.grant.grantId, expectedRevision: grant.revision });
      await rejection; await vi.waitFor(() => expect(host!.origin()).toBeUndefined());
      expect((await host.stop()).state).toBe('unknown'); expect(stopped).toBeGreaterThan(0);
      allowStop = true;
      expect(await host.verifyStopped()).toEqual({ state: 'stopped', resultUnknown: true });
      expect(await host.verifyStopped()).toEqual({ state: 'stopped', resultUnknown: true });
      expect(journal.hasUnknown()).toBe(true);
      completion.resolve({ status: 'succeeded', result: { content: [{ type: 'text', text: 'late completion' }] } });
      await expect(invoke()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(effects).toBe(1);
    } else if (scenario === 'denied') {
      await expect(result).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(effects).toBe(0); expect(approvals).toBe(1);
    } else {
      await expect(result).resolves.toMatchObject({ content: [{ text: 'host result' }] }); await invoke(); expect(effects).toBe(1); expect(approvals).toBe(1);
    }
    expect((await host.stop()).state).not.toBe('unknown'); expect(host.origin()).toBeUndefined();
    await expect(host.start()).rejects.toThrow('NOT_STARTABLE');
  } finally {
    await host?.stop(); journal?.close(); lease?.close(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
