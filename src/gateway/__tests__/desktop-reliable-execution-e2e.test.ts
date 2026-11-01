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

it.each(['success', 'tampered-receipt', 'missing-capability'] as const)('runs an explicitly granted fixture through real Gateway auth, signed WS and durable journals: %s', async scenario => {
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
    const endpointIdentity = await auth.endpointIdentity();
    await auth.endpointRequest('/api/endpoint-tools/principals', 'POST', { principalId: deviceId, displayName: endpointIdentity.displayName,
      publicKey: endpointIdentity.publicKey, kind: 'desktop', platform: 'desktop' });
    const clientId = randomUUID(), endpointId = deviceId + ':execution-fixture', connectionInstanceId = randomUUID();
    // Fixture owns the pairing key. Production main-process approval/signing is a separate acceptance gate.
    const privateKey = (await store.load(binding))!.privateKey;
    const unsigned = { principalId: deviceId, endpointId, connectionInstanceId, displayName: endpointIdentity.displayName,
      kind: 'desktop' as const, platform: 'desktop', appVersion: 'fixture', availability: 'foreground' as const, nonce: randomUUID(), signedAt: Date.now(), signature: 'pending',
      tools: [descriptor], deviceFrames: { version: 1 as const, authorizationRevision: grant.revision },
      execution: { version: 1 as const, grantId: grant.grant.grantId, authorizationRevision: grant.revision, expiresAt } };
    const hello = { ...unsigned, signature: sign('sha256', Buffer.from(endpointHelloSigningPayload(unsigned)), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    const ticket = await auth.endpointRequest('/api/realtime/tickets', 'POST', { clientId, clientKind: 'desktop', protocolVersion: 2 });
    const connectionProof = await auth.connectionProof(ticket.ticket), frameBinding = { gatewayId: binding.gatewayId, deviceId, clientId, connectionInstanceId, authorizationRevision: grant.revision };
    const gatewayFrameBinding = { gatewayId: binding.gatewayId, deviceId, clientId, connectionInstanceId };
    signer = new DesktopDeviceFrameSigner(frameBinding, privateKey);
    lease = new DesktopExecutionLease(join(directory, 'journal')); journal = new DesktopOperationJournal(lease);
    let effects = 0, approvals = 0;
    const catalog = new DesktopExecutionCatalog([descriptor]);
    const supervisor = new DesktopOperationSupervisor({ journal, authority: () => ({ gatewayId: binding.gatewayId, deviceId,
      authorizationRevision: grant.revision, toolRevision: revision, expiresAt, active: true }), validateResult: catalog.validateResult,
      createWorker: () => ({ run: async () => { effects += 1; return { status: 'succeeded', result: { content: [{ type: 'text', text: 'fixture result' }] } }; }, stop: async () => ({ confirmed: true }) }) });
    const session = new DesktopExecutionSession({ binding: frameBinding, supervisor, confirm: async () => { approvals += 1; return true; } });
    controller = new DesktopReliableToolController({ catalog, session, availability: () => 'foreground' });
    socket = new WebSocket(origin.replace(/^http/, 'ws') + '/api/realtime/v1/ws'); await once(socket, 'open');
    const ready = scenario === 'missing-capability' ? once(socket, 'close') : once(socket, 'message');
    socket.send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'realtime.hello',
      payload: { clientId, clientKind: 'desktop', ticket: ticket.ticket, connectionProof, endpoint: hello,
        capabilities: scenario === 'missing-capability' ? ['desktop.device-frames.v1'] : ['desktop.device-frames.v1', 'desktop.durable-execution.v1'] } }));
    if (scenario === 'missing-capability') { expect((await ready)[0]).toBe(4401); expect(endpoints.registry.get(endpointId)).toBeUndefined(); expect(effects).toBe(0); return; }
    const readyWire = String((await ready)[0]);
    expect(verifyDesktopGatewayFrame(readyWire, gatewayFrameBinding, binding.publicKey, 0).message.payload.negotiatedCapabilities).toContain('desktop.durable-execution.v1');
    expect(endpoints.registry.get(endpointId)?.executionAuthority).toMatchObject(frameBinding);
    let sequence = 1;
    controller.connect((input: ClientEndpointMessage) => {
      const message = structuredClone(input);
      if (scenario === 'tampered-receipt' && message.type === 'tool.result') message.payload.operationReceipt!.resultHash = 'f'.repeat(64);
      const payload = JSON.parse(signer!.sign(message));
      socket!.send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'desktop.endpoint.message', payload }));
    });
    const handled = Promise.withResolvers<void>();
    socket.on('message', raw => {
      try {
        const verified = verifyDesktopGatewayFrame(raw.toString(), gatewayFrameBinding, binding.publicKey, sequence); sequence = verified.sequence;
        if (verified.message.kind === 'endpoint.message') void controller!.handleMessage(verified.message.payload).then(handled.resolve, handled.reject);
      } catch (error) { handled.reject(error); }
    });
    const args = { text: 'fixture only' }, key = randomUUID();
    const invoke = () => executeExternalOperation({ principalId: deviceId, capabilityId: 'fixture', idempotencyKey: key,
      requestDigest: createHash('sha256').update(canonicalJson(args)).digest('hex'), descriptorDigest: revision, surface: 'fixture', recovery: 'manual' },
    operationId => endpoints.invocations.invoke({ endpointId, toolCallId: 'fixture', toolName: descriptor.name, descriptorRevision: revision, arguments: args, operationId }));
    const result = invoke();
    if (scenario === 'tampered-receipt') {
      await expect(result).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); await expect(invoke()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    } else { await expect(result).resolves.toMatchObject({ content: [{ text: 'fixture result' }] }); await invoke(); }
    await handled.promise; expect(effects).toBe(1); expect(approvals).toBe(1);
    const row = getSqliteDatabase().prepare('SELECT state, desktop_intent_json, desktop_receipt_json FROM capability_operations').get()!;
    expect(row.state).toBe(scenario === 'tampered-receipt' ? 'unknown' : 'succeeded'); expect(row.desktop_intent_json).toBeTypeOf('string');
    expect(row.desktop_receipt_json === null).toBe(scenario === 'tampered-receipt');
  } finally {
    socket?.terminate(); await controller?.disconnect(); journal?.close(); lease?.close(); signer?.close(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
