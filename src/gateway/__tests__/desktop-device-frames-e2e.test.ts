import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { deviceStateDescriptor, type ClientEndpointMessage } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { ConfigSchema } from '../../config/schema.js';
import { DesktopDeviceFrameSigner } from '../../endpoint-tools/desktop-device-frame.js';
import { verifyDesktopGatewayFrame } from '../../endpoint-tools/desktop-frame.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice, setDesktopStateObservation } from '../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it.each(['unsigned', 'replay', 'tampered', 'grant-revision', 'missing-capability', 'stale-hello'] as const)('negotiates independently signed device results through real authenticated Gateway routes and rejects %s frames', async attack => {
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
    const grant = (await owner(`/api/desktop-host/devices/${deviceId}/observation`, 'POST', { state: true, expectedRevision: 0 })).payload;
    const endpointIdentity = await auth.endpointIdentity();
    await auth.endpointRequest('/api/endpoint-tools/principals', 'POST', { principalId: deviceId, displayName: endpointIdentity.displayName,
      publicKey: endpointIdentity.publicKey, kind: 'desktop', platform: 'desktop' });
    const clientId = randomUUID(), endpointId = deviceId + ':signed-state', connectionInstanceId = randomUUID();
    const descriptor = deviceStateDescriptor('desktop', 'state');
    const hello = await auth.signEndpointHello({ principalId: deviceId, endpointId, connectionInstanceId, displayName: endpointIdentity.displayName,
      kind: 'desktop', platform: 'desktop', appVersion: 'fixture', availability: 'foreground', nonce: randomUUID(), signedAt: Date.now(), signature: 'pending',
      tools: [descriptor], deviceFrames: { version: 1, authorizationRevision: attack === 'stale-hello' ? grant.revision - 1 : grant.revision } });
    const ticket = await auth.endpointRequest('/api/realtime/tickets', 'POST', { clientId, clientKind: 'desktop', protocolVersion: 2 });
    const connectionProof = await auth.connectionProof(ticket.ticket);
    const frameBinding = { gatewayId: binding.gatewayId, deviceId, clientId, connectionInstanceId, authorizationRevision: grant.revision };
    const gatewayFrameBinding = { gatewayId: binding.gatewayId, deviceId, clientId, connectionInstanceId };
    signer = new DesktopDeviceFrameSigner(frameBinding, (await store.load(binding))!.privateKey);
    socket = new WebSocket(origin.replace(/^http/, 'ws') + '/api/realtime/v1/ws'); await once(socket, 'open');
    const ready = attack === 'missing-capability' || attack === 'stale-hello' ? once(socket, 'close') : once(socket, 'message');
    socket.send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'realtime.hello',
      payload: { clientId, clientKind: 'desktop', ticket: ticket.ticket, connectionProof, endpoint: hello,
        ...(attack === 'missing-capability' ? {} : { capabilities: ['desktop.device-frames.v1'] }) } }));
    if (attack === 'missing-capability' || attack === 'stale-hello') {
      expect((await ready)[0]).toBe(4401); expect(endpoints.registry.get(endpointId)).toBeUndefined(); return;
    }
    const readyWire = String((await ready)[0]);
    expect(verifyDesktopGatewayFrame(readyWire, gatewayFrameBinding, binding.publicKey, 0).message.payload.negotiatedCapabilities).toContain('desktop.device-frames.v1');
    const registered = endpoints.registry.get(endpointId)!;
    const input = once(socket, 'message');
    const invocation = endpoints.invocations.invoke({ endpointId, toolCallId: randomUUID(), toolName: descriptor.name, arguments: {}, descriptorRevision: registered.tools[0].revision });
    const command = verifyDesktopGatewayFrame(String((await input)[0]), gatewayFrameBinding, binding.publicKey, 1).message;
    const invocationId = command.payload.payload.invocationId;
    const send = (message: ClientEndpointMessage) => {
      const payload = JSON.parse(signer!.sign(message));
      socket!.send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'desktop.endpoint.message', payload }));
      return payload;
    };
    send({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), type: 'tool.received', payload: { invocationId } });
    const result: ClientEndpointMessage = { protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), type: 'tool.result', payload: { invocationId,
      content: [{ type: 'json', value: { capturedAt: Date.now(), platform: 'fixture', systemVersion: 'fixture', locale: 'zh-CN', timezone: 'Asia/Shanghai' } }] } };
    const previous = send(result); expect((await invocation).content).toMatchObject([{ type: 'json', value: { platform: 'fixture' } }]);
    const closed = once(socket, 'close');
    const availability: ClientEndpointMessage = { protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), type: 'endpoint.availability_changed', payload: { availability: 'background' } };
    if (attack === 'unsigned') socket.send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'endpoint.message', payload: availability }));
    else {
      const payload = attack === 'replay' ? previous : JSON.parse(signer.sign(availability));
      if (attack === 'tampered') payload.message.payload.availability = 'foreground';
      // Bypass route socket cleanup deliberately, verifying the per-frame durable grant check itself.
      if (attack === 'grant-revision') setDesktopStateObservation(deviceId, true, grant.revision);
      socket.send(JSON.stringify({ protocolVersion: 2, messageId: randomUUID(), sentAt: Date.now(), kind: 'desktop.endpoint.message', payload }));
    }
    expect((await closed)[0]).toBe(4400);
    await vi.waitFor(() => expect(endpoints.registry.get(endpointId)).toBeUndefined());
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute');
  } finally {
    signer?.close(); socket?.terminate(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
