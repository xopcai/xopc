import crypto from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { EndpointToolHostController, EndpointToolRegistry } from '@xopcai/endpoint-tools-client';
import { deviceFolderSigningPayload, DEVICE_FOLDER_SEARCH, DEVICE_FOLDER_READ, endpointHelloSigningPayload, personalDescriptor,
  type DeviceFolderSnapshot, type EndpointHelloPayload, type EndpointTurnClaim } from '@xopcai/endpoint-tools-protocol';
import { RealtimeClient, type RealtimeWebSocket } from '@xopcai/realtime-client';
import { REALTIME_PROTOCOL_VERSION } from '@xopcai/realtime-protocol';
import WebSocket from 'ws';
import { expect, it, vi } from 'vitest';

import { uploadDesktopFrame } from '../../../electron/computer/frame-upload.js';
import { DesktopFolderStore } from '../../../electron/files/device-folders.js';
import { EndpointToolProvider } from '../../agent/external-tools/endpoint-provider.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { recordDeviceExecutionActor } from '../../endpoint-tools/execution-actor.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { createDevice, issueDeviceTokenPair } from '../../storage/sqlite/device-access-repository.js';
import { createEndpointPrincipal } from '../../storage/sqlite/endpoint-principal-repository.js';
import { getOrCreateGatewayIdentity } from '../../storage/sqlite/gateway-identity-repository.js';
import { claimNextSessionInput, insertSessionInput } from '../../storage/sqlite/session-input-repository.js';
import { createHonoApp } from '../hono/app.js';
import { proofDigest, requestProofMessage } from '../security/device-request-proof.js';
import type { GatewayService } from '../service.js';

it('searches and reads only the authorized folder of the chosen computer over signed HTTP and real WebSocket', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xopc-device-folders-'));
  const folderPath = join(root, 'Downloads');
  const secret = join(root, 'quote-private.txt');
  mkdirSync(folderPath);
  writeFileSync(secret, 'private outside the grant');
  writeFileSync(join(folderPath, 'quote-1.txt'), 'fixture quote is 42');
  writeFileSync(join(folderPath, '.quote-hidden.txt'), 'hidden');
  symlinkSync(secret, join(folderPath, 'quote-link.txt'));

  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(root, 'xopc.db') });
  seedTestAgentCatalog();
  const endpointTools = new EndpointToolRuntime({ uploadRoot: join(root, 'uploads') });
  const realtime = new RealtimeRuntime(endpointTools);
  const token = 'device-folders-fixture-owner';
  const auth = { mode: 'token' as const, token };
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth } }), endpointTools, realtime,
    getResolvedAuth: () => auth, getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  let client: RealtimeClient | undefined;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    const base = `http://127.0.0.1:${address.port}`;
    const path = '/api/endpoint-tools/device-connections';
    function sign(message: string, key: crypto.KeyObject) {
      return crypto.sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    }
    function owner(target: string, body?: unknown) {
      return fetch(base + target, { method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    }
    function phone(displayName: string) {
      const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const device = createDevice({ displayName, platform: 'ios', publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
        scopes: ['device.self', 'sessions.write'] });
      const tokens = issueDeviceTokenPair(device.id), credential = tokens.accessToken;
      const source = createEndpointPrincipal({ id: device.id, displayName, kind: 'mobile', platform: 'ios',
        publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') });
      const origin = { type: 'endpoint' as const, endpointId: device.id + ':fixture' };
      const calendar = personalDescriptor('mobile.calendar.query_events');
      const confirm = vi.fn(async () => true);
      const execute = vi.fn(async (args: Record<string, unknown>) => ({ content: [{ type: 'json' as const, value: {
        startAt: args.startAt, endAt: args.endAt, capturedAt: Date.now(), timeZone: 'UTC',
        accessScope: 'all_accessible', truncated: false, events: [],
      } }] }));
      const toolHost = new EndpointToolHostController({ registry: new EndpointToolRegistry([
        { descriptor: calendar, execute }, { descriptor: personalDescriptor('mobile.contacts.pick'), execute: async () => ({ content: [] }) },
      ]), getAvailability: () => 'foreground', createMessageId: crypto.randomUUID, confirm });
      const hello: EndpointHelloPayload = { endpointId: origin.endpointId, principalId: source.id, connectionInstanceId: crypto.randomUUID(),
        displayName, kind: 'mobile', platform: 'ios', appVersion: '1', availability: 'foreground',
        nonce: crypto.randomUUID(), signedAt: Date.now(), signature: 'pending', tools: [calendar, personalDescriptor('mobile.contacts.pick')] };
      hello.signature = sign(endpointHelloSigningPayload(hello), keys.privateKey);
      const connectionId = crypto.randomUUID();
      endpointTools.connect(hello, connectionId, { readyState: 1, send: data => void toolHost.handleMessage(JSON.parse(data)), close: () => toolHost.disconnect() });
      toolHost.connect(message => endpointTools.handleMessage(origin.endpointId, connectionId, message));
      const request = (target: string, payload?: unknown, methodOverride?: 'PUT') => {
        const body = payload === undefined ? undefined : JSON.stringify(payload);
        const method = methodOverride ?? (body ? 'POST' : 'GET');
        const headers = new Headers({ Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' });
        const proof = { timestamp: Date.now(), nonce: crypto.randomBytes(24).toString('base64url'), digest: proofDigest(body ?? '') };
        const message = requestProofMessage({ gatewayId: getOrCreateGatewayIdentity().id, credential, method, target,
          headers: name => headers.get(name) ?? undefined, proof });
        headers.set('X-Xopc-Proof', `${proof.timestamp}.${proof.nonce}.${proof.digest}.${sign(message, keys.privateKey)}`);
        return fetch(base + target, { method, headers, body });
      };
      return { device, origin, tokens, request, connectionId, confirm, execute };
    }
    const first = phone('Phone with permission'), second = phone('Other phone');
    const login = await fetch(base + '/api/browser-session', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: base },
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const browserSessionId = ((await login.json()).conversationId as string).split(':').at(-1)!;
    const mobileChat = { endpointId: first.origin.endpointId, toolName: 'mobile.calendar.query_events' };
    const startWebChat = (request: typeof mobileChat) => fetch(base + path + '/chat', {
      method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
    expect((await second.request(path + '/chat', mobileChat)).status).toBe(403);
    expect((await startWebChat({ ...mobileChat, toolName: 'mobile.device.get_location' })).status).toBe(409);
    endpointTools.registry.heartbeat(first.origin.endpointId, first.connectionId, 'background');
    expect((await startWebChat(mobileChat)).status).toBe(409);
    endpointTools.registry.heartbeat(first.origin.endpointId, first.connectionId, 'foreground');
    const webChat = await startWebChat(mobileChat);
    expect(webChat.status).toBe(201);
    const { conversationId: webConversationId } = (await webChat.json()).payload;
    expect(endpointTools.targets.get(webConversationId)).toMatchObject({ endpointId: mobileChat.endpointId, mobileTool: mobileChat.toolName });
    const webOrigin = { type: 'endpoint' as const, endpointId: 'web-client' };
    insertSessionInput({ id: crypto.randomUUID(), conversationId: webConversationId, clientMessageId: 'calendar-input',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Read my calendar', origin: webOrigin });
    recordDeviceExecutionActor(webConversationId, 'calendar-input', {
      kind: 'owner', principalId: `browser:${browserSessionId}`, browserSessionId, scopes: ['gateway.admin'],
    });
    claimNextSessionInput(webConversationId, crypto.randomUUID());
    const calendarProvider = new EndpointToolProvider({ runtime: endpointTools, getCurrentContext: () => ({
      conversationId: webConversationId, channel: 'webchat', chatId: webConversationId, origin: webOrigin,
    }) });
    const [calendarTool] = await calendarProvider.catalog();
    expect(await calendarProvider.catalog()).toEqual([expect.objectContaining({ namespace: first.origin.endpointId })]);
    expect(calendarTool.toolRef).toContain(mobileChat.toolName);
    expect(calendarTool.description).toContain('phone selected for this chat');
    await calendarProvider.execute(calendarTool.toolRef, { startAt: 1, endAt: 2 }, undefined, { toolCallId: 'calendar' });
    expect(first.confirm).toHaveBeenCalledOnce();
    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).not.toHaveBeenCalled();
    endpointTools.registry.heartbeat(first.origin.endpointId, first.connectionId, 'background');
    expect(await calendarProvider.catalog()).toEqual([]);
    const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const desktopId = crypto.randomUUID(), endpointId = desktopId + ':test';
    const registration = { principalId: desktopId, displayName: 'Test Mac', kind: 'desktop' as const, platform: 'darwin',
      publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') };
    expect((await owner('/api/endpoint-tools/principals', registration)).status).toBe(201);
    const store = new DesktopFolderStore(() => join(root, 'local-folders.json'), () => 'text/plain');
    const registry = new EndpointToolRegistry(store.definitions());
    const controller = new EndpointToolHostController({ registry, getAvailability: () => 'background', createMessageId: crypto.randomUUID,
      confirm: async () => false, uploadFile: (grant, file, context) => uploadDesktopFrame({ base, token, endpointId, grant, file, ...context }) });
    const clientId = crypto.randomUUID();
    client = new RealtimeClient({ clientId, clientKind: 'desktop', createMessageId: crypto.randomUUID,
      issueTicket: async () => (await (await owner('/api/realtime/tickets', { clientId, clientKind: 'desktop', protocolVersion: REALTIME_PROTOCOL_VERSION })).json()).payload,
      getWebSocketUrl: () => base.replace('http:', 'ws:') + '/api/realtime/v1/ws',
      createWebSocket: url => new WebSocket(url) as unknown as RealtimeWebSocket });
    let origin: EndpointTurnClaim | undefined;
    client.setEndpoint({
      createHello: async () => {
        const hello: EndpointHelloPayload = { principalId: desktopId, endpointId, displayName: registration.displayName,
          kind: 'desktop', platform: 'darwin', appVersion: '1', availability: 'background', connectionInstanceId: crypto.randomUUID(),
          nonce: crypto.randomUUID(), signedAt: Date.now(), signature: 'pending', tools: registry.descriptors() };
        hello.signature = sign(endpointHelloSigningPayload(hello), keys.privateKey);
        return hello;
      },
      onReady: ready => { origin = { type: 'endpoint', endpointId, token: ready.turnToken }; controller.connect(message => client!.sendEndpointMessage(message)); },
      onMessage: message => { void controller.handleMessage(message); },
      onDisconnected: () => controller.disconnect(),
    });
    client.connect();
    await vi.waitFor(() => expect(origin).toBeDefined());
    const publication = (snapshot: DeviceFolderSnapshot) => ({ origin: origin!, snapshot,
      signature: sign(deviceFolderSigningPayload(origin!, snapshot), keys.privateKey) });
    const publish = async (snapshot: DeviceFolderSnapshot) => { expect((await owner(path + '/folders', publication(snapshot))).status).toBe(200); };
    const snapshot = await store.change({ kind: 'downloads', path: realpathSync(folderPath), mobileIds: [first.device.id] }, publish);
    const folderId = snapshot.folders[0].id;
    expect((await fetch(base + path)).status).toBe(401);
    expect((await owner(path + '/folders', { ...publication(snapshot), signature: 'x'.repeat(86) })).status).toBe(403);
    expect((await first.request(path + '/folders', publication(snapshot))).status).toBe(403);
    const catalog = await (await first.request(path)).json();
    expect(catalog.payload.currentDeviceId).toBe(first.device.id);
    expect(catalog.payload.devices.find((entry: { id: string }) => entry.id === desktopId).folders).toEqual([{ id: folderId, kind: 'downloads', label: 'Downloads' }]);
    const unrelated = await (await second.request(path)).json();
    expect(JSON.stringify(unrelated)).not.toContain(folderId);
    expect((await second.request(path + '/chat', { endpointId })).status).toBe(403);
    const chat = await first.request(path + '/chat', { endpointId });
    expect(chat.status).toBe(201);
    const { conversationId } = (await chat.json()).payload;
    const targetPath = '/api/endpoint-tools/targets/' + conversationId;
    expect(await (await first.request(targetPath)).json()).toMatchObject({ payload: { deviceName: 'Test Mac', deviceState: 'ready' } });
    expect((await second.request(targetPath)).status).toBe(403);
    insertSessionInput({ id: crypto.randomUUID(), conversationId, clientMessageId: 'find-quote', requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'queued', content: 'Find quote', origin: first.origin });
    recordDeviceExecutionActor(conversationId, 'find-quote', { kind: 'device', principalId: first.device.id,
      deviceId: first.device.id, scopes: first.device.scopes });
    claimNextSessionInput(conversationId, crypto.randomUUID());
    const provider = new EndpointToolProvider({ runtime: endpointTools, getCurrentContext: () => ({
      conversationId, channel: 'webchat', chatId: conversationId, origin: first.origin,
    }) });
    const tools = await provider.search('quote');
    const search = tools.find(tool => tool.toolRef.endsWith(DEVICE_FOLDER_SEARCH))!;
    const read = tools.find(tool => tool.toolRef.endsWith(DEVICE_FOLDER_READ))!;
    expect(search).toBeDefined();
    expect(read).toBeDefined();
    await expect(provider.execute(search.toolRef, { folderId: crypto.randomUUID(), query: 'quote' }, undefined, { toolCallId: 'denied' })).rejects.toThrow(/authorized/);
    const matched = await provider.execute(search.toolRef, { folderId, query: 'quote' }, undefined, { toolCallId: 'find' });
    const [result] = (matched.structuredContent as { content: [{ value: { files: Array<{ name: string; ref: string }> } }] }).content;
    expect(result.value.files.map(file => file.name)).toEqual(['quote-1.txt']);
    const file = await provider.execute(read.toolRef, { folderId, ref: result.value.files[0].ref }, undefined, { toolCallId: 'read' });
    expect(JSON.stringify(file.content)).toContain('fixture quote is 42');
    expect(JSON.stringify(file.content)).toContain('Test Mac');
    const previousToken = origin!.token;
    client.disconnect();
    await vi.waitFor(() => expect(endpointTools.registry.get(endpointId)).toBeUndefined());
    expect(await provider.describe(search.toolRef)).toBeUndefined();
    expect(await (await first.request(targetPath)).json()).toMatchObject({ payload: { deviceState: 'offline' } });
    client.connect();
    await vi.waitFor(() => expect(origin!.token).not.toBe(previousToken));
    expect(await (await first.request(targetPath)).json()).toMatchObject({ payload: { deviceState: 'reselect', reselectEndpointId: endpointId } });
    expect(await provider.describe(search.toolRef)).toBeUndefined();
    expect((await first.request(targetPath, { endpointId }, 'PUT')).status).toBe(200);
    expect(await (await first.request(targetPath)).json()).toMatchObject({ payload: { deviceState: 'ready' } });
    expect(await provider.describe(search.toolRef)).toBeDefined();
    await store.change({ id: folderId, mobileIds: [], revoke: true }, publish);
    expect(await provider.describe(search.toolRef)).toBeUndefined();
    expect((await first.request(path + '/chat', { endpointId })).status).toBe(403);
    expect(await (await first.request(targetPath)).json()).toMatchObject({ payload: { deviceState: 'authorization_required' } });
    expect((await owner(path + '/folders', publication(snapshot))).status).toBe(409);
    client.disconnect();
    await vi.waitFor(() => expect(endpointTools.registry.get(endpointId)).toBeUndefined());
    expect((await first.request(path + '/chat', { endpointId })).status).toBe(409);
    expect(await (await first.request(targetPath)).json()).toMatchObject({ payload: { deviceState: 'offline' } });
  } finally {
    client?.disconnect(); realtime.close(); endpointTools.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    rmSync(root, { force: true, recursive: true });
  }
}, 15_000);
