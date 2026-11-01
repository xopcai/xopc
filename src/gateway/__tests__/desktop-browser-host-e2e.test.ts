import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { REMOTE_BROWSER_DESCRIPTOR, type RemoteBrowserCommand } from '@xopcai/browser-control-contract/remote';
import type { DesktopExecutionGrant } from '@xopcai/gateway-contract';
import { type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';

import { RemoteDeviceBrowserDriver } from '../../browser/remote/device-driver.js';
import { hasReviewedDesktopExecutionStop } from '../../storage/sqlite/desktop-operation-repository.js';
import { DesktopBrowserSession } from '../../../electron/desktop/browser-session.js';
import { DesktopDeviceAuth } from '../../../electron/desktop/device-auth.js';
import { DesktopIdentityStore } from '../../../electron/desktop/device-identity.js';
import { desktopAuthTransport } from '../../../electron/desktop/device-transport.js';
import { DesktopExecutionCatalog } from '../../../electron/desktop/execution-catalog.js';
import { DesktopExecutionHost } from '../../../electron/desktop/execution-host.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../../../electron/desktop/operation-journal.js';
import { invokeRemoteBrowserCommand } from '../../browser/remote/endpoint-transport.js';
import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it.each(['success', 'lost-result', 'driver-recovery'] as const)('runs durable Browser commands through signed HTTP/WSS with injected browser Broker and native approval: %s', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-browser-host-'));
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
    const { deviceId } = await auth.enroll({ displayName: 'Browser fixture', consent: async () => true,
      setup: async () => (await owner('/api/desktop-host/pairing-setups', 'POST', { sshOrigin: origin })).payload.invitation,
      approve: async (id, revision) => { await owner(`/api/device-pairing/requests/${id}/decision`, 'POST', { decision: 'approve', expectedRevision: revision }); } });
    const catalog = new DesktopExecutionCatalog([REMOTE_BROWSER_DESCRIPTOR as never]);
    const approved: DesktopExecutionGrant = { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 120000,
      toolRevisions: { [REMOTE_BROWSER_DESCRIPTOR.name]: catalog.revision(REMOTE_BROWSER_DESCRIPTOR.name)! } };
    const authorization = await auth.endpointRequest('/api/desktop-host/execution', 'POST', { expectedRevision: 0, grant: approved }, deviceId);
    lease = new DesktopExecutionLease(join(root, 'executor')); journal = new DesktopOperationJournal(lease);
    let currentIntent: DesktopOperationIntent | undefined, effects = 0, allow = false;
    const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#123456' } }).png().toBuffer();
    const ownerId = randomUUID(), sessionId = randomUUID(); let revision = 0;
    const broker = { execute: vi.fn(async (command: RemoteBrowserCommand) => {
      expect(journal!.inspect(currentIntent!)).toMatchObject({ state: 'running' });
      if (command.input.action === 'click') effects += 1;
      const close = command.input.action === 'close';
      const observation = { sessionId, tabId: 'tab-1', documentId: 'document-1', revision: ++revision,
        url: 'https://fixture.invalid/', title: 'Fixture', nodes: [], changes: { added: [], changed: [], removed: [] } };
      return { result: { ok: true as const, receipt: { action: command.input.action, risk: 'read' as const, durationMs: 0, verified: true,
        ...(!close ? { observation } : {}) } }, dispatch: 'completed' as const,
        ...(!close ? { frame: { bytes: new Uint8Array(image), mimeType: 'image/png' as const } } : {}) };
    }), dispose: vi.fn(async () => ({ confirmed: true })) };
    const confirm = vi.fn(async () => allow), createBroker = vi.fn(() => broker);
    host = new DesktopExecutionHost({ binding, auth, appVersion: 'fixture', approved, authorizationRevision: authorization.revision, catalog, journal, foreground: () => true,
      confirm, createWorker: () => { throw new Error('Browser must not use the generic executor'); }, onState: () => {},
      createBrowser: uploadFrame => new DesktopBrowserSession({ current: () => true, createBroker, uploadFrame,
        prepareOperation: async intent => { currentIntent = intent; } }) });
    await host.start(); await vi.waitFor(() => expect(host!.origin()).toBeDefined());
    const endpointId = host.origin()!.endpointId;
    const make = (input: RemoteBrowserCommand['input']): RemoteBrowserCommand => ({ version: 1, owner: ownerId, sessionId, actionId: randomUUID(), input });
    const invoke = (command: RemoteBrowserCommand) => invokeRemoteBrowserCommand(endpoints, endpointId, command);
    const metadata = (result: Awaited<ReturnType<typeof invoke>>) => {
      const json = result.content.find(item => item.type === 'json'); if (!json || json.type !== 'json') throw new Error('Missing Browser result');
      const file = result.content.find(item => item.type === 'file');
      if (file?.type === 'file') {
        const bytes = endpoints.uploads.takeComputerFrame(file.fileId, result.invocationId!); expect(bytes).toEqual(image); bytes?.fill(0);
      }
      return json.value;
    };
    await expect(invoke(make({ action: 'observe', visual: 'always' }))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(createBroker).not.toHaveBeenCalled(); expect(broker.execute).not.toHaveBeenCalled();
    allow = true;
    expect(metadata(await invoke(make({ action: 'navigate', url: 'https://fixture.invalid/' })))).toMatchObject({ result: { ok: true } });
    expect(metadata(await invoke(make({ action: 'observe', visual: 'always' })))).toMatchObject({ dispatch: 'completed' });
    const action = make({ action: 'click', revision: 2, ref: 'e1' });
    if (scenario !== 'success') {
      const driver = new RemoteDeviceBrowserDriver(endpoints, endpointId, ownerId);
      if (scenario === 'driver-recovery') { await driver.connect(); await driver.createSession(sessionId); }
      const deliver = endpoints.invocations.handleMessage.bind(endpoints.invocations);
      vi.spyOn(endpoints.invocations, 'handleMessage').mockImplementation((id, message) => {
        if (message.type === 'tool.result' && effects === 1) { void host!.stop(); return; }
        return deliver(id, message);
      });
      await expect(scenario === 'driver-recovery' ? driver.perform(sessionId, { action: 'click', revision: 2, ref: 'e1' }) : invoke(action)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
      await host.verifyStopped();
      expect(journal.inspect(currentIntent!)).toMatchObject({ state: 'succeeded', executionStopped: true });
      expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(currentIntent!.operationId)).toEqual({ state: 'unknown' });
      await expect(invoke(action)).rejects.toThrow();
      if (scenario === 'driver-recovery') {
        const original = currentIntent!, scope = { gatewayId: original.gatewayId, deviceId, authorizationRevision: authorization.revision,
          tool: REMOTE_BROWSER_DESCRIPTOR.name, toolRevision: original.toolRevision };
        expect(hasReviewedDesktopExecutionStop(scope)).toBe(false);
        await expect(driver.closeSession(sessionId)).rejects.toThrow();
        await auth.endpointRequest('/api/desktop-host/execution', 'DELETE', { grantId: approved.grantId, expectedRevision: authorization.revision }, deviceId);
        expect(hasReviewedDesktopExecutionStop(scope)).toBe(false);
        const review = { reviewId: randomUUID(), expectedGeneration: 1, intentFingerprint: createHash('sha256').update(JSON.stringify(original)).digest('hex'),
          executorStopped: true, localStatus: 'recorded', receipt: journal.inspect(original) };
        expect(await auth.endpointRequest(`/api/desktop-host/operations/${original.operationId}/review`, 'POST', review, deviceId)).toMatchObject({ reviewed: true, outcome: 'unknown' });
        expect(hasReviewedDesktopExecutionStop(scope)).toBe(true);
        const before = broker.execute.mock.calls.length;
        await driver.closeSession(sessionId); await driver.disconnect(); expect(broker.execute).toHaveBeenCalledTimes(before);
        expect(getSqliteDatabase().prepare('SELECT state FROM capability_operations WHERE operation_id=?').get(original.operationId)?.state).toBe('unknown');
      }
    } else {
      expect(metadata(await invoke(action))).toMatchObject({ result: { ok: true } });
      await invoke(action); expect(effects).toBe(1);
      await expect(invoke({ ...action, input: { action: 'click', revision: 2, ref: 'other' } })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      expect(effects).toBe(1);
      const driver = new RemoteDeviceBrowserDriver(endpoints, endpointId, ownerId);
      await driver.connect(); await driver.createSession(sessionId);
      const observed = await driver.observe(sessionId, { action: 'observe', visual: 'always' });
      expect(observed.sessionId).toBe(sessionId); expect(Buffer.from(observed.visual!.data, 'base64')).toEqual(image);
      await driver.closeSession(sessionId); await driver.disconnect();
    }
    expect(effects).toBe(1); expect(createBroker).toHaveBeenCalledOnce();
    expect(await readdir(join(root, 'frames'))).toEqual([]); passed = true;
  } finally {
    await host?.stop(); channel?.close(); realtime.close(); endpoints.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    journal?.close(); lease?.close(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (passed) await rm(root, { recursive: true, force: true }); else console.error(`Browser Host failure fixture retained: ${root}`);
  }
});
