import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import type { DesktopExecutionGrant } from '@xopcai/gateway-contract';
import { type DesktopOperationIntent, type EndpointHelloPayload } from '@xopcai/endpoint-tools-protocol';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';

import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { ConfigSchema } from '../../config/schema.js';
import { assertDesktopExecutionHello } from '../../endpoint-tools/desktop-execution.js';
import { desktopDeviceEndpointKey } from '../../endpoint-tools/desktop-observation.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it.each([REMOTE_COMPUTER_DESCRIPTOR, REMOTE_BROWSER_DESCRIPTOR])('uses independent execution credentials for ephemeral $name frames through real authenticated HTTP', async descriptor => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-computer-upload-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(root, 'frames') }), realtime = new RealtimeRuntime(endpoints, id => getDevice(id)?.revokedAt === undefined);
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const service = { currentConfig: config, endpointTools: endpoints, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }), server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  let passed = false;
  let channel: ReturnType<typeof desktopAuthTransport> | undefined, signer: { close(): void } | undefined;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const owner = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBeLessThan(300); return response.json();
    };
    const identity = (await owner('/api/desktop-host/compatibility')).payload;
    const binding = { profileId: randomUUID(), gatewayId: identity.gatewayId, publicKey: identity.publicKey, origin };
    // Injected fixture storage/consent. This checks HTTP/proofs/upload isolation, not OS or native Computer actions.
    const encryption = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (bytes: Buffer) => bytes.toString() };
    const store = new DesktopIdentityStore(join(root, 'identity'), encryption);
    channel = desktopAuthTransport(binding, 'ssh');
    const uploads: Buffer[] = [];
    const client = new DesktopDeviceAuth(binding, store, async (path, method, body, headers, signal) => {
      if (path.includes('/files?')) { expect(headers?.Authorization).not.toBe(`Bearer ${token}`); expect(Buffer.isBuffer(body)).toBe(true); uploads.push(body as Buffer); }
      return channel!.request(path, method, body, headers, signal);
    });
    const { deviceId } = await client.enroll({ displayName: 'Computer upload fixture', consent: async () => true,
      setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).payload.invitation,
      approve: async (requestId, revision) => { await owner(`/api/device-pairing/requests/${requestId}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); },
    });
    const upload = descriptor.name === REMOTE_BROWSER_DESCRIPTOR.name ? client.uploadBrowserFrame.bind(client) : client.uploadComputerFrame.bind(client);
    const toolRevision = endpointToolRevision(descriptor as never);
    const approved: DesktopExecutionGrant = { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 120000,
      toolRevisions: { [descriptor.name]: toolRevision } };
    const authorization = await client.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: 0, grant: approved }, deviceId);
    expect(authorization.active).toBe(true); expect(getDevice(deviceId)?.scopes).not.toContain('desktop.observe.screen');
    const principal = await client.endpointIdentity(), endpointId = `${deviceId}:${randomUUID()}`, clientId = randomUUID();
    await client.endpointRequest('/api/endpoint-tools/principals', 'POST', { principalId: deviceId, displayName: principal.displayName, publicKey: principal.publicKey, kind: 'desktop', platform: 'desktop' }, deviceId);
    const hello: EndpointHelloPayload = { principalId: deviceId, endpointId, connectionInstanceId: randomUUID(), displayName: principal.displayName, kind: 'desktop', platform: 'desktop', appVersion: 'fixture', availability: 'foreground',
      nonce: randomUUID(), signedAt: Date.now(), signature: 'pending', tools: [descriptor as never],
      deviceFrames: { version: 1, authorizationRevision: authorization.revision }, execution: { version: 1, grantId: approved.grantId, authorizationRevision: authorization.revision, expiresAt: approved.expiresAt } };
    const signed = await client.prepareExecutionEndpoint(hello, clientId, approved); signer = signed.signer;
    const device = getDevice(deviceId)!, key = desktopDeviceEndpointKey(device), capabilities = ['desktop.device-frames.v1', 'desktop.durable-execution.v1'];
    expect(() => assertDesktopExecutionHello(device, signed.hello, key, binding.gatewayId, clientId, capabilities)).toThrow('EXECUTION_DENIED');
    const authority = assertDesktopExecutionHello(device, signed.hello, key, binding.gatewayId, clientId, [...capabilities, descriptor.name === REMOTE_BROWSER_DESCRIPTOR.name ? 'desktop.browser.v1' : 'desktop.computer.v1']);
    endpoints.connect(signed.hello, randomUUID(), { readyState: 1, send: vi.fn(), close: vi.fn() }, authority);
    const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#123456' } }).png().toBuffer();
    const request = (bytes = Buffer.from(image), mimeType = 'image/png', name = 'observation.png') => {
      const invocationId = randomUUID(), grant = endpoints.uploads.createGrant(invocationId, endpointId, Date.now(), 'computer-frame', deviceId);
      const intent: DesktopOperationIntent = { operationId: randomUUID(), gatewayId: binding.gatewayId, deviceId, tool: descriptor.name,
        argumentHash: 'a'.repeat(64), toolRevision, authorizationRevision: authorization.revision, expiresAt: Date.now() + 25000 };
      return { endpointId, deviceId, invocationId, grant, approved, intent, authorizationRevision: authorization.revision,
        file: { name, mimeType, bytes }, signal: new AbortController().signal };
    };
    const input = request(), expectedHash = createHash('sha256').update(input.file.bytes).digest('hex');
    const uploading = upload(input); input.file.bytes.fill(0);
    const file = await uploading;
    expect(file.sha256).toBe(expectedHash); expect(uploads).toHaveLength(1); expect(uploads[0].every(byte => byte === 0)).toBe(true);
    expect(endpoints.uploads.getFile(file.fileId)).toBeUndefined();
    expect(endpoints.uploads.readFile(file.fileId)).toBeUndefined();
    const frame = endpoints.uploads.takeComputerFrame(file.fileId, input.invocationId); expect(frame).toEqual(image); frame?.fill(0);
    expect(await readdir(join(root, 'frames'))).toEqual([]);
    const jpeg = await sharp(image).jpeg().toBuffer();
    expect((await upload(request(jpeg, 'image/jpeg', 'observation.jpg'))).mimeType).toBe('image/jpeg');
    const before = uploads.length, valid = request();
    for (const patch of [{ invocationId: randomUUID() }, { endpointId: `${randomUUID()}:${randomUUID()}` }, { grant: { ...valid.grant, maxFiles: 2 } },
      { grant: { ...valid.grant, maxBytes: 5 * 1024 * 1024 + 1 } }, { grant: { ...valid.grant, path: '/api/endpoint-tools/invocations/' + randomUUID() + '/files' } },
      { file: { ...valid.file, name: '../observation.png' } }, { file: { ...valid.file, mimeType: 'application/octet-stream' } },
      { intent: { ...valid.intent, deviceId: randomUUID() } }, { intent: { ...valid.intent, expiresAt: Date.now() - 1 } }]) {
      await expect(upload({ ...valid, ...patch })).rejects.toThrow();
    }
    const other = descriptor.name === REMOTE_BROWSER_DESCRIPTOR.name ? client.uploadComputerFrame.bind(client) : client.uploadBrowserFrame.bind(client);
    await expect(other(valid)).rejects.toThrow('UPLOAD_DENIED');
    expect(uploads).toHaveLength(before);
    await client.endpointRequest('/api/desktop-host/execution', 'DELETE', { grantId: approved.grantId, expectedRevision: authorization.revision }, deviceId);
    await expect(upload(request())).rejects.toThrow('UPLOAD_DENIED');
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.observe.screen'); passed = true;
  } finally {
    signer?.close(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (passed) await rm(root, { recursive: true, force: true }); else console.error(`Control frame failure fixture retained: ${root}`);
  }
});
