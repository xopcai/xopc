import { createHash, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
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
import { DesktopOperationReviewManager } from '../../../electron/desktop/operation-review.js';
import { DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR } from '../../../electron/desktop/clipboard-tool.js';
import { recordDesktopOperationIntent } from '../../storage/sqlite/desktop-operation-repository.js';
it.each(['clipboard', 'computer-not-started', 'browser-not-started'] as const)('requires native human review, restores a lost acknowledgement and never replays the old intent: %s', async scenario => {
  const legacyFrames = false; let loseReviewAck = false, tamperList = false;
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
    if (new URL(request.url).pathname.endsWith('/review') && loseReviewAck && response.ok) { loseReviewAck = false; return Response.json({ ok: false }, { status: 503 }); }
    if (new URL(request.url).pathname === '/api/desktop-host/operations' && tamperList && response.ok) { const value = await response.json(); value.payload.items[0].generation += 1; return Response.json(value); }
    return response;
  }, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  let execution: DesktopExecutionManager | undefined,  channel: ReturnType<typeof desktopAuthTransport> | undefined;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    config.gateway.corsOrigins = [origin];
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
    const descriptor = scenario === 'clipboard' ? DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR : scenario === 'browser-not-started' ? REMOTE_BROWSER_DESCRIPTOR : REMOTE_COMPUTER_DESCRIPTOR, revision = endpointToolRevision(descriptor), args = { text: 'fixture only' };
    const approved = await client.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: 0, grant: { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(),
      toolRevisions: { [descriptor.name]: revision }, expiresAt: Date.now() + 60000 } });
    const executorRoot = join(directory, 'executor'), lease = new DesktopExecutionLease(executorRoot), journal = new DesktopOperationJournal(lease);
    let effects = 0, intent: any;
    const invoke = (key: string) => executeExternalOperation({ principalId: deviceId, capabilityId: 'fixture', idempotencyKey: key,
      requestDigest: createHash('sha256').update(canonicalJson(args)).digest('hex'), descriptorDigest: revision, surface: 'fixture', recovery: 'manual' }, async operationId => {
      intent = recordDesktopOperationIntent({ operationId, gatewayId: binding.gatewayId, deviceId, tool: descriptor.name,
        argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex'), toolRevision: revision, authorizationRevision: approved.revision, expiresAt: Date.now() + 10000 }, approved.grant.grantId);
      if (scenario === 'clipboard') {
        journal.record(intent); journal.start(intent, { invocationId: randomUUID(), connectionInstanceId: randomUUID() });
        effects += 1; journal.finish(intent, 'succeeded', 'a'.repeat(64));
      }
      throw new Error('Fixture transport lost before acknowledgement');
    });
    await expect(invoke('original')).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); journal.close(); lease.close();
    let allow = false, approvals = 0;
    const review = new DesktopOperationReviewManager({ manager, store, executorRoot, execution: { requireStopped: async () => {} } as any,
      visible: () => true, confirm: async () => { approvals += 1; return allow; } });
    expect(await review.list(manager.snapshot().epoch, id)).toMatchObject([{ intent }]);
    tamperList = true; await expect(review.list(manager.snapshot().epoch, id)).rejects.toThrow('AUTHORITY_RESPONSE_INVALID'); tamperList = false;
    await expect(review.review(manager.snapshot().epoch, id, intent.operationId)).rejects.toThrow('CONSENT_DENIED');
    expect(approvals).toBe(1); expect(getSqliteDatabase().prepare('SELECT count(*) AS count FROM desktop_operation_reviews').get()?.count).toBe(0);
    allow = true; loseReviewAck = true;
    await expect(review.review(manager.snapshot().epoch, id, intent.operationId)).rejects.toThrow('AUTH_UNAVAILABLE');
    expect(approvals).toBe(2);
    expect(await review.review(manager.snapshot().epoch, id, intent.operationId)).toMatchObject({ reviewed: true, outcome: 'unknown' });
    expect(approvals).toBe(2); expect(effects).toBe(scenario === 'clipboard' ? 1 : 0); expect(await review.list(manager.snapshot().epoch, id)).toEqual([]);
    const state = getSqliteDatabase().prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(intent.operationId);
    expect(state?.state).toBe('unknown');
    await expect(invoke('original')).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(effects).toBe(scenario === 'clipboard' ? 1 : 0);
    const forbidden = await fetch(origin + `/api/desktop-host/operations/${intent.operationId}/review`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
    expect(forbidden.status).toBe(403);
    await expect(review.review(manager.snapshot().epoch, id, randomUUID())).rejects.toThrow(); expect(approvals).toBe(2);
  } finally {
    channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
