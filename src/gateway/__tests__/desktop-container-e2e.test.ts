import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { DesktopContainerEngine } from '../../../electron/desktop/container-engine.js';
import { DesktopContainerResources } from '../../../electron/desktop/container-resources.js';
import { DesktopContainerSession } from '../../../electron/desktop/container-session.js';
import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { DesktopExecutionManager } from '../../../electron/desktop/execution-manager.js';
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

it.skipIf(process.env.XOPC_CONTAINER_LIVE !== '1')('executes device-signed container commands through authenticated Gateway and Agent Provider with separate workspace authority and no implicit repeat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-container-gateway-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(root, 'uploads') }), realtime = new RealtimeRuntime(endpoints, id => getDevice(id)?.revokedAt === undefined);
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const service = { currentConfig: config, endpointTools: endpoints, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }), server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  let execution: DesktopExecutionManager | undefined, channel: ReturnType<typeof desktopAuthTransport> | undefined, engine: DesktopContainerEngine | undefined, volume: string | undefined;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const owner = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBeLessThan(300); return response.json();
    };
    // Fixture crypto/native approval are injected; installed OS approval is a separate acceptance run.
    const encryption = { available: async () => true, encrypt: async (text: string) => Buffer.from(text), decrypt: async (bytes: Buffer) => bytes.toString() };
    const manager = new GatewayConnectionPreview(new ConnectionProfileStore(join(root, 'connections')), new ConnectionCredentialStore(join(root, 'credentials'), encryption));
    await manager.initialize(); const saved = await manager.save(0, { name: 'Container fixture', origin, transport: 'ssh', credential: token });
    const id = saved.profiles[0].id; await manager.select(saved.epoch, id);
    const identity = (await owner('/api/desktop-host/compatibility')).payload;
    expect(identity.capabilities.containerCommandVersion).toBe(1);
    await manager.pinIdentity(manager.snapshot().epoch, id, { gatewayId: identity.gatewayId, publicKey: identity.publicKey });
    const binding = { profileId: id, origin, gatewayId: identity.gatewayId, publicKey: identity.publicKey }, store = new DesktopIdentityStore(join(root, 'identities'), encryption);
    channel = desktopAuthTransport(binding, 'ssh'); const client = new DesktopDeviceAuth(binding, store, channel.request);
    const { deviceId } = await client.enroll({ displayName: 'Container fixture', consent: async () => true,
      setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).payload.invitation,
      approve: async (requestId, revision) => { await owner(`/api/device-pairing/requests/${requestId}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); },
    });
    engine = await DesktopContainerEngine.connect(); const imageId = await engine.resolveInstalledImage('node:26.12.1-bookworm-slim');
    const epoch = manager.snapshot().epoch, container = new DesktopContainerSession(engine, imageId, new DesktopContainerResources(join(root, 'resources'), encryption), () => manager.snapshot().epoch === epoch);
    let allowed = false, confirmations = 0;
    execution = new DesktopExecutionManager({ manager, store, executorRoot: join(root, 'executor'), catalog: container.catalog(), appVersion: 'fixture', foreground: () => true,
      consent: async (_binding, _grant, signal) => { await container.authorizeWorkspace(signal); return true; },
      confirm: async () => { confirmations += 1; return allowed; }, createWorker: (_tool, intent) => container.worker(intent!) });
    await container.activate(execution, epoch, id); volume = `xopc-workspace-${container.ownerId}-${container.workspaceId}`;
    await vi.waitFor(() => expect(execution!.origin()).toBeDefined());
    const endpointId = execution.origin()!.endpointId;
    const conversationId = randomUUID();
    const provider = new EndpointToolProvider({ runtime: endpoints, getCurrentContext: () => ({ channel: 'webchat', chatId: 'fixture', conversationId, origin: { type: 'endpoint', endpointId } }) });
    const ref = externalToolRef('endpoint', endpointId, 'desktop.command.run');
    const invoke = (argv: string[], key = randomUUID(), workspaceId = container.workspaceId) => provider.execute(ref, { workspaceId, argv }, undefined, { toolCallId: key });
    await expect(invoke(['node'], randomUUID(), randomUUID())).rejects.toThrow('not authorized'); expect(confirmations).toBe(0);
    await expect(invoke(['node', '-e', 'x'.repeat(4000)])).rejects.toThrow(); expect(confirmations).toBe(0);
    await expect(invoke(['node', '-e', "console.log('not executed')"])).rejects.toThrow(); expect(confirmations).toBe(1);
    allowed = true; const key = randomUUID();
    const result = await invoke(['node', '-e', "require('fs').writeFileSync('/home/node/fixture.txt','volume persisted');console.log('container fixture ok')"], key);
    expect(JSON.stringify(result)).toContain('container fixture ok');
    expect(JSON.stringify(await invoke(['node', '-e', "console.log(require('fs').readFileSync('/home/node/fixture.txt','utf8'))"]))).toContain('volume persisted');
    const before = confirmations;
    await invoke(['node', '-e', "require('fs').writeFileSync('/home/node/fixture.txt','volume persisted');console.log('container fixture ok')"], key);
    expect(confirmations).toBe(before);
    const nonzero = await invoke(['node', '-e', 'process.exit(7)']);
    expect(nonzero.structuredContent).toMatchObject({ content: [{ type: 'json', value: { exitCode: 7 } }] });
    const operations = getSqliteDatabase().prepare("SELECT desktop_intent_json,desktop_receipt_json FROM capability_operations WHERE state='succeeded' AND desktop_intent_json IS NOT NULL").all();
    expect(operations.length).toBeGreaterThanOrEqual(3);
    for (const operation of operations) expect(JSON.parse(String(operation.desktop_receipt_json))).toMatchObject({ state: 'succeeded', executionStopped: true });
    await manager.select(manager.snapshot().epoch, id);
    await vi.waitFor(() => expect(execution!.snapshot()).toMatchObject({ state: 'stopped', remoteRevocationConfirmed: true }));
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute');
  } finally {
    await execution?.requireStopped(); channel?.close(); realtime.close(); endpoints.close(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (volume && engine) execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'volume', 'rm', volume], { stdio: 'ignore' });
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(root, { recursive: true, force: true });
  }
}, 30000);
