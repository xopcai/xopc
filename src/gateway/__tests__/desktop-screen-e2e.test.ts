import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { serve } from '@hono/node-server';
import { screenCaptureDescriptor, endpointHelloSigningPayload, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import WebSocket, { type WebSocketServer } from 'ws';

import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { DesktopObservationManager } from '../../../electron/desktop/observation-manager.js';
import { ConnectionCredentialStore } from '../../../electron/gateway/credentials.js';
import { GatewayConnectionPreview } from '../../../electron/gateway/connection-manager.js';
import { ConnectionProfileStore } from '../../../electron/gateway/profiles.js';
import { EndpointToolProvider } from '../../agent/external-tools/endpoint-provider.js';
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

it('uploads only individually confirmed screenshots through signed grants, keeps frames ephemeral and stops on forged calls or revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xopc-desktop-observation-'));
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
    let consent = false, revokeDuringConsent = false, reads = 0, approveCapture = false, foreground = true;
    let barrier: ReturnType<typeof Promise.withResolvers<Buffer>> | undefined, captureAborted = false;
    const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#123456' } }).png().toBuffer();
    observer = new DesktopObservationManager({ manager, store, appVersion: 'fixture', visible: () => true, consent: async () => { throw new Error('State consent must not authorize screenshots'); },
      selectScreen: async () => {
        if (revokeDuringConsent) await client.endpointRequest('/api/desktop-host/screen', 'DELETE');
        return consent ? { foreground: () => foreground, confirm: async () => approveCapture, capture: async signal => { reads++; if (barrier) { signal.addEventListener('abort', () => { captureAborted = true; }, { once: true }); return barrier.promise; } return Buffer.from(image); } } : undefined;
      }, readState: async () => { throw new Error('Screenshot grant must not read device state'); } });
    await expect(observer.start(manager.snapshot().epoch, id, 'screen')).rejects.toThrow('DESKTOP_LOCAL_CONSENT_DENIED');
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.observe.screen'); expect(reads).toBe(0);
    consent = true; revokeDuringConsent = true;
    await expect(observer.start(manager.snapshot().epoch, id, 'screen')).rejects.toThrow('DESKTOP_OBSERVATION_REVISION_CHANGED');
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.observe.screen'); expect(reads).toBe(0);
    revokeDuringConsent = false;
    await observer.start(manager.snapshot().epoch, id, 'screen'); await until(() => Boolean(observer?.origin()));
    const endpoint = endpoints.registry.list().find(endpoint => endpoint.principalId === deviceId)!;
    expect(endpoint.tools.map(tool => tool.descriptor.name)).toEqual(['desktop.screen.capture']);
    expect(realtime.canConfigureEndpoint(endpoint.endpointId)).toBe(false);
    const invoke = () => endpoints.invocations.invoke({ endpointId: endpoint.endpointId, toolCallId: randomUUID(), toolName: 'desktop.screen.capture', arguments: {}, descriptorRevision: endpoint.tools[0].revision });
    foreground = false; expect(await observer.readyOrigin()).toBeUndefined();
    await expect(invoke()).rejects.toMatchObject({ code: 'ENDPOINT_NOT_FOREGROUND' }); expect(reads).toBe(0);
    foreground = true; expect(await observer.readyOrigin()).toBeDefined();
    await expect(invoke()).rejects.toMatchObject({ code: 'USER_DENIED' }); expect(reads).toBe(0);
    approveCapture = true;
    const result = await invoke(); expect(reads).toBe(1);
    const file = result.content[0]; if (file.type !== 'file') throw new Error('Missing screenshot');
    expect(file).toMatchObject({ name: 'screenshot.png', mimeType: 'image/png', size: image.length });
    expect(endpoints.uploads.getFile(file.fileId)).toBeUndefined(); expect(endpoints.uploads.readFile(file.fileId)).toBeUndefined();
    const bytes = endpoints.uploads.takeComputerFrame(file.fileId, result.invocationId!); expect(Buffer.from(bytes!)).toEqual(image); bytes!.fill(0);
    expect(endpoints.uploads.takeComputerFrame(file.fileId, result.invocationId!)).toBeUndefined();
    expect(await readdir(join(directory, 'files'))).toEqual([]);
    const conversationId = randomUUID();
    const provider = new EndpointToolProvider({ runtime: endpoints, getCurrentContext: () => ({ channel: 'webchat', chatId: 'fixture', conversationId, origin: observer!.origin()! }) });
    const [hit] = await provider.search('screenshot'); expect(hit).toBeDefined();
    const descriptor = await provider.describe(hit.toolRef); expect(descriptor?.batchRead).toBe(false);
    const projected = await provider.execute(hit.toolRef, {}, undefined, { toolCallId: randomUUID(), contractRevision: descriptor!.contractRevision });
    expect(projected.content.some(content => content.type === 'image')).toBe(true); expect(reads).toBe(2);
    expect(await readdir(join(directory, 'files'))).toEqual([]);
    barrier = Promise.withResolvers<Buffer>(); const aborted = new AbortController();
    const pending = endpoints.invocations.invoke({ endpointId: endpoint.endpointId, toolCallId: randomUUID(), toolName: 'desktop.screen.capture', arguments: {}, descriptorRevision: endpoint.tools[0].revision, signal: aborted.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TOOL_CANCELLED' });
    await until(() => reads === 3); aborted.abort(); await rejected; await until(() => captureAborted);
    const late = Buffer.from(image); barrier.resolve(late); await until(() => late.every(byte => byte === 0)); barrier = undefined;
    expect(await readdir(join(directory, 'files'))).toEqual([]);

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
    await rejectedHello([{ ...screenCaptureDescriptor(), name: 'desktop.file.save' }]);
    await rejectedHello([screenCaptureDescriptor()], randomUUID());
    await rejectedHello([screenCaptureDescriptor()], deviceId, true);
    expect(reads).toBe(3);
    // Deliberately bypass the fixture Gateway signer to model an untrusted relay injecting a tool frame.
    const sockets = (realtime as unknown as { wss: WebSocketServer }).wss.clients;
    expect(sockets.size).toBe(1);
    [...sockets][0].send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'endpoint.message', payload: { type: 'tool.invoke' } }));
    await until(() => observer?.snapshot()?.state === 'error'); expect(observer.origin()).toBeUndefined(); expect(reads).toBe(3);
    observer.stop(); await observer.start(manager.snapshot().epoch, id, 'screen'); await until(() => Boolean(observer?.origin()));
    const authorization = (await owner(`/api/desktop-host/devices/${deviceId}/screen`)).payload;
    await owner(`/api/desktop-host/devices/${deviceId}/screen`, 'POST', { screen: false, expectedRevision: authorization.revision });
    await until(() => observer?.origin() === undefined); expect(reads).toBe(3);
    await until(() => observer?.snapshot()?.state === 'error');
    expect(getDevice(deviceId)?.scopes).toEqual(['gateway.status', 'device.self']);
    observer.stop();
  } finally {
    observer?.stop(); await observer?.whenStopped(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
