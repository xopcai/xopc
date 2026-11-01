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
import { DesktopExecutionLease, DesktopOperationJournal } from '../../../electron/desktop/operation-journal.js';
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

it.skipIf(process.env.XOPC_CONTAINER_LIVE !== '1')('keeps a real signed Docker terminal root running across Agent calls, denies and deduplicates stdin, and closes with independent container evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-terminal-gateway-'));
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
    const epoch = manager.snapshot().epoch, container = new DesktopContainerSession(engine, imageId, new DesktopContainerResources(join(root, 'resources'), encryption), () => manager.snapshot().epoch === epoch, undefined, true);
    let allowed = false, confirmations = 0, inputAllowed = false, inputConfirmations = 0;
    execution = new DesktopExecutionManager({ manager, store, executorRoot: join(root, 'executor'), catalog: container.catalog(), appVersion: 'fixture', foreground: () => true,
      consent: async (_binding, _grant, signal) => { await container.authorizeWorkspace(signal); return true; },
      confirm: async () => { confirmations += 1; return allowed; }, createWorker: (_tool, intent) => container.worker(intent!),
      createTerminal: (intent, binding, emit, lease) => container.terminal(intent, binding, emit, lease),
      confirmTerminalInput: async () => { inputConfirmations += 1; return inputAllowed; } });
    await container.activate(execution, epoch, id); volume = `xopc-workspace-${container.ownerId}-${container.workspaceId}`;
    await vi.waitFor(() => expect(execution!.origin()).toBeDefined());
    const endpointId = execution.origin()!.endpointId;
    const conversationId = randomUUID();
    const provider = new EndpointToolProvider({ runtime: endpoints, getCurrentContext: () => ({ channel: 'webchat', chatId: 'fixture', conversationId, origin: { type: 'endpoint', endpointId } }) });
    const openRef = externalToolRef('endpoint', endpointId, 'desktop.terminal.open');
    const controlRef = externalToolRef('endpoint', endpointId, 'desktop.terminal.control');
    const open = (key = randomUUID()) => provider.execute(openRef, { workspaceId: container.workspaceId, argv: ['/bin/sh'] }, undefined, { toolCallId: key });
    await expect(open()).rejects.toThrow(); expect(confirmations).toBe(1);
    allowed = true; const opened = await open();
    const state = opened.structuredContent!.content as Array<{ value: { sessionId: string; generation: string; operationId: string; executionStopped: boolean } }>;
    const terminal = state[0].value;
    expect(terminal.executionStopped).toBe(false);
    const control = (args: Record<string, unknown>, key = randomUUID()) => provider.execute(controlRef, { sessionId: terminal.sessionId, generation: terminal.generation, ...args }, undefined, { toolCallId: key });
    const rootRow = () => getSqliteDatabase().prepare('SELECT state,desktop_receipt_json FROM capability_operations WHERE operation_id=?').get(terminal.operationId)!;
    expect(rootRow().state).toBe('running'); expect(rootRow().desktop_receipt_json).toBeNull();
    await expect(control({ action: 'input', generation: randomUUID(), text: 'must not dispatch' })).rejects.toThrow(); expect(inputConfirmations).toBe(0);
    expect(JSON.stringify(await control({ action: 'input', text: 'printf DENIED\r' }))).toContain('notStarted');
    expect(inputConfirmations).toBe(1);
    inputAllowed = true; const key = randomUUID();
    const text = "printf x >> /home/node/input-count; printf 'PTY_%s\\n' READY\r";
    expect(JSON.stringify(await control({ action: 'input', text }, key))).toContain('accepted');
    await control({ action: 'input', text }, key); expect(inputConfirmations).toBe(2);
    let output = '';
    const read = async () => {
      const result = await control({ action: 'read' });
      const value = (result.structuredContent!.content as Array<{ value: { frames: Array<{ bytes: string }> } }>)[0].value;
      output += Buffer.concat(value.frames.map(frame => Buffer.from(frame.bytes, 'base64'))).toString();
    };
    await vi.waitFor(async () => { await read(); expect(output).toContain('PTY_READY'); }, { timeout: 5000 });
    expect(output).not.toContain('DENIED');
    await control({ action: 'resize', columns: 100, rows: 30 });
    await control({ action: 'input', text: "printf 'COUNT_'; wc -c < /home/node/input-count; stty size\r" });
    await vi.waitFor(async () => { await read(); expect(output).toMatch(/COUNT_1\r?\n/); expect(output).toMatch(/30 100\r?\n/); }, { timeout: 5000 });
    expect(rootRow().state).toBe('running');
    const closed = await control({ action: 'close' }); expect(JSON.stringify(closed)).toContain('executionStopped');
    expect(rootRow().state).toBe('succeeded'); expect(JSON.parse(String(rootRow().desktop_receipt_json))).toMatchObject({ state: 'succeeded', executionStopped: true });
    await expect(control({ action: 'input', text: 'no resume\r' })).rejects.toThrow();
    const next = await open(), nextTerminal = (next.structuredContent!.content as Array<{ value: typeof terminal }>)[0].value;
    const receive = endpoints.handleMessage.bind(endpoints); let dropped = false;
    const receiving = vi.spyOn(endpoints, 'handleMessage').mockImplementation((endpoint, connection, message) => {
      if (!dropped && message.type === 'terminal.event' && message.payload.event.event === 'input-ack' && message.payload.event.dispatch === 'accepted') {
        dropped = true; return;
      }
      receive(endpoint, connection, message);
      if (dropped && message.type === 'terminal.event' && message.payload.event.event === 'output'
        && Buffer.from(message.payload.event.bytes, 'base64').toString().includes('EFFECT_READY')) void execution!.stop();
    });
    try {
      await expect(provider.execute(controlRef, { sessionId: nextTerminal.sessionId, generation: nextTerminal.generation, action: 'input', text: "printf x >> /home/node/lost-count.txt; printf 'EFFECT_%s\\n' READY\r" }, undefined, { toolCallId: randomUUID() })).rejects.toThrow();
      expect(dropped).toBe(true);
      await vi.waitFor(() => expect(execution!.snapshot()?.state).toBe('stopped'), { timeout: 5000 });
      const row = getSqliteDatabase().prepare('SELECT state,desktop_intent_json FROM capability_operations WHERE operation_id=?').get(nextTerminal.operationId)!;
      expect(row.state).toBe('unknown');
      const recoveredLease = new DesktopExecutionLease(join(root, 'executor')), journal = new DesktopOperationJournal(recoveredLease);
      try {
        const receipt = journal.inspect(JSON.parse(String(row.desktop_intent_json)));
        expect(receipt?.executionStopped).toBe(true); expect(['unknown', 'stopped']).toContain(receipt?.state); expect(journal.hasUnknown()).toBe(true);
      }
      finally { journal.close(); recoveredLease.close(); }
      const count = execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', '1000:1000',
        '--mount', `type=volume,source=${volume},target=/home/node,readonly`, '--entrypoint', 'node', imageId, '-e', "process.stdout.write(require('fs').readFileSync('/home/node/lost-count.txt','utf8'))"], { encoding: 'utf8', timeout: 5000 });
      expect(count).toBe('x');
    } finally { receiving.mockRestore(); }
    await manager.select(manager.snapshot().epoch, id);
    await vi.waitFor(() => expect(execution!.snapshot()).toMatchObject({ state: 'stopped', remoteRevocationConfirmed: true }));
    expect(getDevice(deviceId)?.scopes).not.toContain('desktop.execute');
  } catch (error) {
    console.info('Terminal E2E primary failure', error); throw error;
  } finally {
    await execution?.requireStopped(); channel?.close(); realtime.close(); endpoints.close(); await endpoints.terminals.whenStopped(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (volume && engine) execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'volume', 'rm', volume], { stdio: 'ignore' });
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); await rm(root, { recursive: true, force: true });
  }
}, 30000);
