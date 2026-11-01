import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { DesktopExecutionLease } from '../../../electron/desktop/operation-journal.js';
import { DesktopExecutionManager } from '../../../electron/desktop/execution-manager.js';
import { DesktopWorkspaceHelper } from '../../../electron/desktop/workspace-helper.js';
import { DesktopWorkspaceSession } from '../../../electron/desktop/workspace-session.js';
import { GatewayConnectionPreview } from '../../../electron/gateway/connection-manager.js';
import { ConnectionProfileStore } from '../../../electron/gateway/profiles.js';
import { ConnectionCredentialStore } from '../../../electron/gateway/credentials.js';
import { EndpointToolProvider } from '../../agent/external-tools/endpoint-provider.js';
import { externalToolRef } from '../../agent/external-tools/refs.js';
import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it.skipIf(process.platform !== 'darwin')('executes native workspace reads and durable writes through authenticated Gateway and enforces device/workspace, version and lifetime boundaries', async () => {
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
    const root = join(directory, 'authorized'); await mkdir(root);
    await writeFile(join(root, 'read.txt'), 'fixture read');
    const addon = join(directory, 'workspace.node');
    execFileSync('c++', ['-std=c++17', '-DNAPI_VERSION=8', '-bundle', '-undefined', 'dynamic_lookup', '-I', join(dirname(dirname(process.execPath)), 'include/node'),
      'electron/native/desktop-workspace-macos.cc', '-o', addon]);
    const helper = await DesktopWorkspaceHelper.open(addon, root), epoch = manager.snapshot().epoch;
    const workspace = new DesktopWorkspaceSession({ helper, current: () => manager.snapshot().epoch === epoch });
    let reads = 0, writes = 0, allowRead = false;
    const catalog = workspace.catalog(), executorRoot = join(directory, 'executor');
    execution = new DesktopExecutionManager({ manager, store, executorRoot, catalog, appVersion: 'fixture', foreground: () => true,
      consent: async () => true, confirm: async () => { writes += 1; return true; },
      confirmRead: async () => { reads += 1; return allowRead; }, createWorker: tool => workspace.worker(tool) });
    await workspace.activate(execution, epoch, id);
    expect(helper.identity().path).toContain('authorized');
    await vi.waitFor(() => expect(execution!.origin()).toBeDefined());
    const endpointId = execution.origin()!.endpointId;
    const args = { workspaceId: workspace.workspaceId, relativePath: 'read.txt' };
    const read = (input = args) => endpoints.invocations.invoke({ endpointId, toolCallId: randomUUID(), toolName: 'desktop.workspace.read',
      descriptorRevision: catalog.revision('desktop.workspace.read')!, arguments: input });
    await expect(read({ ...args, workspaceId: randomUUID() })).rejects.toThrow('not authorized'); expect(reads).toBe(0);
    await expect(read()).rejects.toMatchObject({ code: 'USER_DENIED' }); expect(reads).toBe(1);
    allowRead = true; expect(await read()).toMatchObject({ content: [{ type: 'json', value: { result: { text: 'fixture read' } } }] });
    const key = randomUUID(), conversationId = randomUUID();
    const provider = new EndpointToolProvider({ runtime: endpoints, getCurrentContext: () => ({ channel: 'webchat', chatId: 'fixture', conversationId,
      origin: { type: 'endpoint', endpointId } }) });
    const write = (input: Record<string, unknown>, operationKey = randomUUID()) => provider.execute(
      externalToolRef('endpoint', endpointId, 'desktop.workspace.write'), input, undefined, { toolCallId: operationKey });
    const create = { workspaceId: workspace.workspaceId, relativePath: 'new.txt', text: 'native fixture', expectedVersion: null };
    await write(create, key); await write(create, key);
    expect(writes).toBe(1); expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('native fixture');
    await expect(write({ ...create, relativePath: '../outside.txt' })).rejects.toThrow('WORKSPACE_PATH_INVALID');
    await expect(readFile(join(directory, 'outside.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    const before = await read({ workspaceId: workspace.workspaceId, relativePath: 'new.txt' });
    const version = (before.content[0] as any).value.result.version;
    await writeFile(join(root, 'new.txt'), 'external');
    await expect(write({ ...create, text: 'replacement', expectedVersion: version })).rejects.toThrow('WORKSPACE_VERSION_CONFLICT');
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('external');
    const operation = getSqliteDatabase().prepare("SELECT desktop_intent_json,desktop_receipt_json FROM capability_operations WHERE state='succeeded' AND desktop_intent_json IS NOT NULL").get();
    expect(JSON.parse(String(operation?.desktop_intent_json))).toMatchObject({ workspaceId: workspace.workspaceId, deviceId, tool: 'desktop.workspace.write' });
    expect(JSON.parse(String(operation?.desktop_receipt_json))).toMatchObject({ state: 'succeeded', executionStopped: true });
    await manager.select(manager.snapshot().epoch, id);
    await vi.waitFor(() => expect(execution!.snapshot()).toMatchObject({ state: 'stopped', remoteRevocationConfirmed: true }));
    await expect(helper.request({ action: 'read', relativePath: 'read.txt' })).rejects.toThrow('EXECUTOR_STOPPED');
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute');
    const lease = new DesktopExecutionLease(executorRoot); lease.close();
  } finally {
    await execution?.requireStopped(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
