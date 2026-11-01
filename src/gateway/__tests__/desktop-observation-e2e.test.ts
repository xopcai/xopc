import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { serve } from '@hono/node-server';
import { deviceStateDescriptor, endpointHelloSigningPayload, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';

import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { DesktopObservationManager } from '../../../electron/desktop/observation-manager.js';
import { ConnectionCredentialStore } from '../../../electron/gateway/credentials.js';
import { GatewayConnectionPreview } from '../../../electron/gateway/connection-manager.js';
import { ConnectionProfileStore } from '../../../electron/gateway/profiles.js';
import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

async function until(probe: () => boolean | Promise<boolean>, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await probe()) return; await delay(25); }
  throw new Error('Desktop observation E2E condition timed out');
}

it.each([false, true])('executes only explicitly approved state reads with legacy device frames %s, then stops on forged commands and revocation', async legacyFrames => {
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
  let observer: DesktopObservationManager | undefined, channel: ReturnType<typeof desktopAuthTransport> | undefined;
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
    let consent = false, revokeDuringConsent = false, reads = 0;
    observer = new DesktopObservationManager({ manager, store, appVersion: 'fixture', visible: () => true, consent: async () => {
      if (revokeDuringConsent) await client.endpointRequest('/api/desktop-host/observation', 'DELETE');
      return consent;
    },
      readState: async () => { reads++; return { platform: 'fixture', systemVersion: 'test-version', locale: 'zh-CN', timezone: 'Asia/Shanghai' }; } });
    await expect(observer.start(manager.snapshot().epoch, id)).rejects.toThrow('DESKTOP_LOCAL_CONSENT_DENIED');
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.observe.state'); expect(reads).toBe(0);
    consent = true; revokeDuringConsent = true;
    await expect(observer.start(manager.snapshot().epoch, id)).rejects.toThrow('DESKTOP_OBSERVATION_REVISION_CHANGED');
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.observe.state'); expect(reads).toBe(0);
    const instances: string[] = [], clientFrames: string[] = [];
    (realtime as unknown as { wss: WebSocketServer }).wss.on('connection', socket => socket.on('message', data => {
      const message = JSON.parse(String(data));
      if (message.kind === 'realtime.hello' && message.payload.endpoint) instances.push(message.payload.endpoint.connectionInstanceId);
      if (['endpoint.message', 'desktop.endpoint.message'].includes(message.kind)) clientFrames.push(message.kind);
    }));
    revokeDuringConsent = false;
    await observer.start(manager.snapshot().epoch, id); await until(() => Boolean(observer?.origin()));
    const endpoint = endpoints.registry.list().find(endpoint => endpoint.principalId === deviceId)!;
    expect(endpoint.tools.map(tool => tool.descriptor.name)).toEqual(['desktop.device.get_state']);
    expect(realtime.canConfigureEndpoint(endpoint.endpointId)).toBe(false);
    const result = await endpoints.invocations.invoke({ endpointId: endpoint.endpointId, toolCallId: randomUUID(), toolName: 'desktop.device.get_state', arguments: {}, descriptorRevision: endpoint.tools[0].revision });
    expect(result.content).toMatchObject([{ type: 'json', value: { platform: 'fixture', timezone: 'Asia/Shanghai' } }]); expect(reads).toBe(1);
    const previousClaim = observer.origin()!;
    const previousConnection = endpoint.connectionId;
    const previousInstance = instances.at(-1);
    expect(previousInstance).toBeDefined();
    realtime.disconnectPrincipal(deviceId);
    await until(() => {
      const current = endpoints.registry.get(endpoint.endpointId);
      return Boolean(observer?.origin() && current && current.connectionId !== previousConnection);
    });
    const resumed = endpoints.registry.get(endpoint.endpointId)!;
    expect(instances.at(-1)).not.toBe(previousInstance);
    expect(endpoints.registry.verifyTurnClaim(endpoint.endpointId, previousClaim.token)).toBe(false);
    expect(endpoints.registry.verifyTurnClaim(endpoint.endpointId, observer.origin()!.token)).toBe(true);
    const resumedResult = await endpoints.invocations.invoke({ endpointId: resumed.endpointId, toolCallId: randomUUID(), toolName: 'desktop.device.get_state', arguments: {}, descriptorRevision: resumed.tools[0].revision });
    expect(resumedResult.content).toMatchObject([{ type: 'json', value: { platform: 'fixture' } }]);
    expect(reads).toBe(2);
    expect(clientFrames.length).toBeGreaterThanOrEqual(4);
    expect(clientFrames.every(kind => kind === (legacyFrames ? 'endpoint.message' : 'desktop.endpoint.message'))).toBe(true);
    await expect(endpoints.invocations.invoke({ endpointId: endpoint.endpointId, toolCallId: randomUUID(), toolName: 'desktop.file.save', arguments: {}, descriptorRevision: endpoint.tools[0].revision })).rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' });
    const wrongKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
    await expect(client.endpointRequest('/api/endpoint-tools/principals', 'POST', { principalId: deviceId, displayName: 'State-only desktop', kind: 'desktop', platform: 'desktop', publicKey: wrongKey })).rejects.toThrow('DESKTOP_OBSERVATION_DENIED');
    const record = (await store.load(binding))!;
    const rejectedHello = async (tools: EndpointHelloPayload['tools'], principalId = deviceId, ownerTicket = false) => {
      const clientId = randomUUID(), ticketInput = { clientId, clientKind: 'desktop', protocolVersion: 2 };
      const ticket = ownerTicket ? (await owner('/api/realtime/tickets', 'POST', ticketInput)).payload : await client.endpointRequest('/api/realtime/tickets', 'POST', ticketInput);
      const hello: EndpointHelloPayload = { principalId, endpointId: randomUUID(), connectionInstanceId: randomUUID(), kind: 'desktop', platform: 'desktop', displayName: record.displayName,
        appVersion: '1', availability: 'background', signedAt: Date.now(), nonce: randomUUID(), signature: 'pending', tools };
      hello.signature = sign('sha256', Buffer.from(endpointHelloSigningPayload(hello)), { key: record.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      const connectionProof = await client.connectionProof(ticket.ticket), socket = new WebSocket(origin.replace(/^http/, 'ws') + '/api/realtime/v1/ws');
      await once(socket, 'open'); const closed = once(socket, 'close');
      socket.send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'realtime.hello', payload: { ticket: ticket.ticket, connectionProof, clientId, clientKind: 'desktop', endpoint: hello } }));
      expect((await closed)[0]).toBe(4401);
    };
    await rejectedHello([{ ...deviceStateDescriptor('desktop', 'state'), name: 'desktop.file.save' }]);
    await rejectedHello([deviceStateDescriptor('desktop', 'state')], randomUUID());
    await rejectedHello([deviceStateDescriptor('desktop', 'state')], deviceId, true);
    expect(reads).toBe(2);
    // Deliberately bypass the fixture Gateway signer to model an untrusted relay injecting a tool frame.
    const sockets = (realtime as unknown as { wss: WebSocketServer }).wss.clients;
    expect(sockets.size).toBe(1);
    [...sockets][0].send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'endpoint.message', payload: { type: 'tool.invoke' } }));
    await until(() => observer?.snapshot()?.state === 'error'); expect(observer.origin()).toBeUndefined(); expect(reads).toBe(2);
    observer.stop(); await observer.start(manager.snapshot().epoch, id); await until(() => Boolean(observer?.origin()));
    const authorization = (await owner(`/api/desktop-host/devices/${deviceId}/observation`)).payload;
    await owner(`/api/desktop-host/devices/${deviceId}/observation`, 'POST', { state: false, expectedRevision: authorization.revision });
    await until(() => observer?.origin() === undefined); expect(reads).toBe(2);
    await until(() => observer?.snapshot()?.state === 'error');
    expect(getDevice(deviceId)?.scopes).toEqual(['gateway.status', 'device.self']);
    observer.stop();
  } finally {
    observer?.stop(); await observer?.whenStopped(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
