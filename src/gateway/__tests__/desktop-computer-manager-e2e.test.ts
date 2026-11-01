import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';
import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { DesktopBrowserSession } from '../../../electron/desktop/browser-session.js';
import { invokeRemoteBrowserCommand } from '../../browser/remote/endpoint-transport.js';
import { expect, it, vi } from 'vitest';

import { createNativeComputerSession } from '../../../electron/desktop/computer-native-session.js';
import { DesktopComputerResources } from '../../../electron/desktop/computer-resources.js';
import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { DesktopExecutionCatalog } from '../../../electron/desktop/execution-catalog.js';
import { DesktopExecutionManager } from '../../../electron/desktop/execution-manager.js';
import { GatewayConnectionPreview } from '../../../electron/gateway/connection-manager.js';
import { ConnectionProfileStore } from '../../../electron/gateway/profiles.js';
import { ConnectionCredentialStore } from '../../../electron/gateway/credentials.js';
import { invokeComputerCommand } from '../../computer/endpoint-transport.js';
import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it.each(['computer', 'browser'] as const)('negotiates remote %s before native consent and revokes its independent execution grant on an epoch change', async kind => {
  const descriptor = kind === 'computer' ? REMOTE_COMPUTER_DESCRIPTOR : REMOTE_BROWSER_DESCRIPTOR;
  const capability = kind === 'computer' ? 'remoteComputerVersion' : 'remoteBrowserVersion';
  const root = await mkdtemp(join(tmpdir(), 'xopc-computer-manager-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(root, 'frames') }), realtime = new RealtimeRuntime(endpoints, id => getDevice(id)?.revokedAt === undefined);
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const service = { currentConfig: config, endpointTools: endpoints, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }); let supported = false;
  const server = serve({ fetch: async request => {
    const response = await app.fetch(request);
    if (!supported && new URL(request.url).pathname === '/api/desktop-host/compatibility' && response.ok) {
      const value = await response.json(); delete value.payload.capabilities[capability];
      return Response.json(value, { status: response.status, headers: response.headers });
    }
    return response;
  }, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  let channel: ReturnType<typeof desktopAuthTransport> | undefined, execution: DesktopExecutionManager | undefined, passed = false;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`;
    config.gateway.corsOrigins = [origin];
    const owner = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(origin + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBeLessThan(300); return response.json();
    };
    const identity = (await owner('/api/desktop-host/compatibility')).payload;
    const encryption = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (bytes: Buffer) => bytes.toString() };
    const manager = new GatewayConnectionPreview(new ConnectionProfileStore(join(root, 'connections')), new ConnectionCredentialStore(join(root, 'credentials'), encryption));
    await manager.initialize(); const saved = await manager.save(0, { name: 'Computer fixture', origin, transport: 'ssh', credential: token });
    const id = saved.profiles[0].id; await manager.select(saved.epoch, id);
    await manager.pinIdentity(manager.snapshot().epoch, id, { gatewayId: identity.gatewayId, publicKey: identity.publicKey });
    const binding = { profileId: id, gatewayId: identity.gatewayId, publicKey: identity.publicKey, origin };
    const store = new DesktopIdentityStore(join(root, 'identity'), encryption);
    channel = desktopAuthTransport(binding, 'ssh'); const auth = new DesktopDeviceAuth(binding, store, channel.request);
    const { deviceId } = await auth.enroll({ displayName: 'Computer manager fixture', consent: async () => true,
      setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).payload.invitation,
      approve: async (requestId, revision) => { await owner(`/api/device-pairing/requests/${requestId}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); } });
    const catalog = new DesktopExecutionCatalog([descriptor as never]);
    const resources = new DesktopComputerResources(join(root, 'resources'), encryption);
    const driver = { warmup: vi.fn(async () => {}), ownedProcessIdentity: () => ({ driverPid: process.pid + 10000, generation: randomUUID() }),
      discover: vi.fn(async () => [{ appId: 'fixture', name: 'Fixture', running: true }]),
      resolveTarget: vi.fn(), observe: vi.fn(), perform: vi.fn(), stop: vi.fn(async () => {}), validateAction: vi.fn() };
    let allow = false;
    const consent = vi.fn<ConstructorParameters<typeof DesktopExecutionManager>[0]['consent']>(async (_binding, grant) => {
      expect(grant.workspaceId).toBeUndefined(); expect(Object.keys(grant.toolRevisions)).toEqual([descriptor.name]); return allow;
    });
    const createComputer = vi.fn<NonNullable<ConstructorParameters<typeof DesktopExecutionManager>[0]['createComputer']>>((uploadFrame) => createNativeComputerSession({ driver, resources, current: () => true, requestApproval: async () => true, uploadFrame }));
    const browserExecute = vi.fn(async () => ({ dispatch: 'completed' as const, result: { ok: true as const,
      receipt: { action: 'tabs' as const, risk: 'read' as const, durationMs: 0, verified: true, tabs: [] } } }));
    const browserStop = vi.fn(async () => ({ confirmed: true }));
    const createBrowser = vi.fn<NonNullable<ConstructorParameters<typeof DesktopExecutionManager>[0]['createBrowser']>>(uploadFrame => new DesktopBrowserSession({
      current: () => true, createBroker: () => ({ execute: browserExecute, dispose: browserStop }), uploadFrame,
    }));
    const createControl = kind === 'computer' ? createComputer : createBrowser;
    execution = new DesktopExecutionManager({ manager, store, executorRoot: join(root, 'executor'), catalog, appVersion: 'fixture', foreground: () => true,
      consent, confirm: async () => true, createWorker: () => { throw new Error('Generic executor is forbidden'); }, createComputer, createBrowser });
    const stopResources = vi.fn(async () => ({ confirmed: true }));
    const start = () => execution!.start(manager.snapshot().epoch, id, { kind, catalog, stopResources });
    await expect(start()).rejects.toThrow('UNSUPPORTED'); expect(consent).not.toHaveBeenCalled(); expect(createControl).not.toHaveBeenCalled();
    supported = true;
    await expect(start()).rejects.toThrow('CONSENT_DENIED'); expect(createControl).not.toHaveBeenCalled();
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute');
    allow = true; await start();
    await vi.waitFor(() => expect(execution!.snapshot()).toMatchObject({ state: 'online', [kind]: true }));
    expect(createControl).toHaveBeenCalledOnce(); expect(driver.warmup).not.toHaveBeenCalled();
    const endpointId = execution.origin()!.endpointId;
    if (kind === 'computer') {
      const result = await invokeComputerCommand(endpoints, endpointId, { op: 'discover', owner: 'conversation', sessionId: 'discovery', query: 'Fixture' });
      expect(result.content).toMatchObject([{ type: 'json', value: { status: 'ready', apps: [{ name: 'Fixture' }] } }]);
      expect(driver.discover).toHaveBeenCalledOnce(); expect(driver.perform).not.toHaveBeenCalled(); expect(createBrowser).not.toHaveBeenCalled();
    } else {
      const result = await invokeRemoteBrowserCommand(endpoints, endpointId, { version: 1, owner: 'conversation', sessionId: 'browser-session', actionId: randomUUID(), input: { action: 'tabs', operation: 'list' } });
      expect(result.content).toMatchObject([{ type: 'json', value: { dispatch: 'completed', result: { ok: true, receipt: { action: 'tabs' } } } }]);
      expect(browserExecute).toHaveBeenCalledOnce(); expect(createComputer).not.toHaveBeenCalled();
    }
    const before = stopResources.mock.calls.length;
    await manager.select(manager.snapshot().epoch, id);
    await vi.waitFor(() => expect(execution!.snapshot()).toMatchObject({ state: 'stopped', remoteRevocationConfirmed: true }));
    expect(stopResources.mock.calls.length).toBeGreaterThan(before); if (kind === 'computer') expect(driver.stop).toHaveBeenCalled(); else expect(browserStop).toHaveBeenCalled();
    expect(execution.origin()).toBeUndefined(); expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute');
    expect(manager.snapshot().selectedId).toBe(id); passed = true;
  } finally {
    await execution?.requireStopped(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (passed) await rm(root, { recursive: true, force: true }); else console.error(`Computer manager failure fixture retained: ${root}`);
  }
}, 30000);
