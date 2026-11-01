import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { REMOTE_COMPUTER_DESCRIPTOR, type ComputerCommand } from '@xopcai/computer-control-contract';
import type { DesktopExecutionGrant } from '@xopcai/gateway-contract';
import { type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';

import { createNativeComputerSession } from '../../../electron/desktop/computer-native-session.js';
import { DesktopComputerResources } from '../../../electron/desktop/computer-resources.js';
import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { DesktopExecutionCatalog } from '../../../electron/desktop/execution-catalog.js';
import { DesktopExecutionHost } from '../../../electron/desktop/execution-host.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../../../electron/desktop/operation-journal.js';
import type { BrokerResult } from '../../computer/broker.js';
import { invokeComputerCommand } from '../../computer/endpoint-transport.js';
import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it.each(['success', 'lost-result'] as const)('runs durable Computer commands through signed HTTP/WSS with injected native driver and approval: %s', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-computer-host-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(root, 'frames') }), realtime = new RealtimeRuntime(endpoints, id => getDevice(id)?.revokedAt === undefined);
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const service = { currentConfig: config, endpointTools: endpoints, realtime,
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }), server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  server.on('upgrade', (request, socket, head) => { if (!realtime.handleUpgrade(request, socket, head)) socket.destroy(); });
  let channel: ReturnType<typeof desktopAuthTransport> | undefined, host: DesktopExecutionHost | undefined;
  let lease: DesktopExecutionLease | undefined, journal: DesktopOperationJournal | undefined, passed = false;
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
    const encryption = { available: async () => true, encrypt: async (value: string) => Buffer.from(value), decrypt: async (bytes: Buffer) => bytes.toString() };
    const store = new DesktopIdentityStore(join(root, 'identity'), encryption);
    channel = desktopAuthTransport(binding, 'ssh'); const auth = new DesktopDeviceAuth(binding, store, channel.request);
    const { deviceId } = await auth.enroll({ displayName: 'Computer fixture', consent: async () => true,
      setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).payload.invitation,
      approve: async (id, revision) => { await owner(`/api/device-pairing/requests/${id}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); } });
    const catalog = new DesktopExecutionCatalog([REMOTE_COMPUTER_DESCRIPTOR as never]);
    const approved: DesktopExecutionGrant = { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 120000,
      toolRevisions: { [REMOTE_COMPUTER_DESCRIPTOR.name]: catalog.revision(REMOTE_COMPUTER_DESCRIPTOR.name)! } };
    const authorization = await auth.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: 0, grant: approved }, deviceId);
    lease = new DesktopExecutionLease(join(root, 'executor')); journal = new DesktopOperationJournal(lease);
    const resources = new DesktopComputerResources(join(root, 'resources'), encryption);
    let currentIntent: DesktopOperationIntent | undefined;
    const ready = resources.ready.bind(resources);
    vi.spyOn(resources, 'ready').mockImplementation(async (intent, driver) => { await ready(intent, driver); currentIntent = intent; });
    const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#123456' } }).png().toBuffer();
    const target = { appId: 'fixture', pid: 1, processIdentity: 'fixture:1', windowId: '1', width: 8, height: 8, geometryRevision: '1' };
    const driver = { warmup: vi.fn(async () => {}), ownedProcessIdentity: () => ({ driverPid: process.pid + 10000, generation: randomUUID() }),
      discover: vi.fn(async () => [{ appId: 'fixture', name: 'Fixture', running: true }]), resolveTarget: vi.fn(async () => target),
      observe: vi.fn(async () => ({ target, summary: 'Fixture', stateDigest: 'fixed', image: new Uint8Array(image), mimeType: 'image/png' as const, imageWidth: 8, imageHeight: 8 })),
      perform: vi.fn(async () => { expect(journal!.inspect(currentIntent!)?.state).toBe('running'); expect((await resources.load(currentIntent!)).phase).toBe('ready'); }),
      stop: vi.fn(async () => {}), validateAction: vi.fn() };
    let allow = false;
    const confirm = vi.fn(async () => allow), nativeApproval = vi.fn(async () => true);
    host = new DesktopExecutionHost({ binding, auth, appVersion: 'fixture', approved, authorizationRevision: authorization.revision, catalog, journal, foreground: () => true,
      confirm, createWorker: () => { throw new Error('Computer must not use the generic executor'); }, onState: () => {},
      createComputer: uploadFrame => createNativeComputerSession({ driver, resources, current: () => true, requestApproval: nativeApproval, uploadFrame }) });
    await host.start(); await vi.waitFor(() => expect(host!.origin()).toBeDefined());
    const endpointId = host.origin()!.endpointId;
    const invoke = (command: ComputerCommand) => invokeComputerCommand(endpoints, endpointId, command);
    const metadata = (result: Awaited<ReturnType<typeof invoke>>) => {
      const json = result.content.find(item => item.type === 'json'); if (!json || json.type !== 'json') throw new Error('Missing Computer result');
      const file = result.content.find(item => item.type === 'file');
      if (file?.type === 'file') {
        const bytes = endpoints.uploads.takeComputerFrame(file.fileId, result.invocationId!); expect(bytes).toEqual(image); bytes?.fill(0);
      }
      return json.value as unknown as Omit<BrokerResult, 'frame'>;
    };
    await expect(invoke({ op: 'discover', owner: 'conversation', sessionId: 'discovery', query: 'Fixture' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(driver.warmup).not.toHaveBeenCalled(); expect(driver.discover).not.toHaveBeenCalled();
    allow = true;
    const apps = metadata(await invoke({ op: 'discover', owner: 'conversation', sessionId: 'discovery', query: 'Fixture' })).apps!;
    const sessionId = randomUUID();
    expect(metadata(await invoke({ op: 'open', owner: 'conversation', sessionId, appRef: apps[0].appRef, mode: 'control', prepare: false,
      model: { modelRef: 'fixture/gui', profile: 'gui-plus-2026-02-26', origin: 'https://model.invalid', runtimeLocation: 'remote' } })).status).toBe('ready');
    const observation = metadata(await invoke({ op: 'observe', owner: 'conversation', sessionId }));
    const action: ComputerCommand = { op: 'act', owner: 'conversation', sessionId, envelope: { actionId: randomUUID(), sessionId, observationId: observation.observation!.id,
      brokerEpoch: observation.brokerEpoch, generation: observation.generation, grantId: observation.grantId!, deadlineAt: Date.now() + 25000,
      action: { kind: 'click', point: { x: 2, y: 2 }, button: 'left', count: 1 } } };
    if (scenario === 'lost-result') {
      const deliver = endpoints.invocations.handleMessage.bind(endpoints.invocations);
      vi.spyOn(endpoints.invocations, 'handleMessage').mockImplementation((id, message) => {
        if (message.type === 'tool.result' && driver.perform.mock.calls.length === 1) { void host!.stop(); return; }
        return deliver(id, message);
      });
      await expect(invoke(action)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
      await host.verifyStopped();
      expect(journal.inspect(currentIntent!)).toMatchObject({ state: 'succeeded', executionStopped: true });
      expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(currentIntent!.operationId)).toEqual({ state: 'unknown' });
      await expect(invoke(action)).rejects.toThrow();
    } else {
      const result = await invoke(action); expect(metadata(result).receipt?.dispatch).toBe('completed');
      expect(await invoke(action)).toEqual(result);
      expect(metadata(await invoke({ op: 'release', owner: 'conversation', sessionId })).status).toBe('stopped');
    }
    expect(driver.perform).toHaveBeenCalledOnce(); expect(nativeApproval).toHaveBeenCalledTimes(2);
    expect(await readdir(join(root, 'frames'))).toEqual([]);
    passed = true;
  } finally {
    await host?.stop(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    journal?.close(); lease?.close(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (passed) await rm(root, { recursive: true, force: true }); else console.error(`Computer Host failure fixture retained: ${root}`);
  }
});
