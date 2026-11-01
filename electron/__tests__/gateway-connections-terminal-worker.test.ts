import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';

import { canonicalJson, type DesktopTerminalOutput } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';

import { DesktopContainerEngine } from '../desktop/container-engine.js';
import { DesktopContainerResources } from '../desktop/container-resources.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../desktop/operation-journal.js';
import { DesktopOperationSupervisor } from '../desktop/operation-supervisor.js';
import { DesktopTerminalLedger } from '../desktop/terminal-input-ledger.js';
import { DesktopTerminalWorker } from '../desktop/terminal-worker.js';
import { DesktopTerminalBroker } from '../desktop/terminal-broker.js';

it('fences cancellation during creation and retries independent removal without starting a late terminal', async () => {
  const workspaceId = randomUUID(), ownerId = randomUUID(), args = { workspaceId, argv: ['/bin/sh'] };
  const intent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), workspaceId, tool: 'desktop.terminal.open',
    argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex'), toolRevision: 'a'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 60000 };
  let created!: (id: string) => void, reached!: () => void;
  const creating = new Promise<void>(resolve => { reached = resolve; });
  const engine = { socketPath: '/private/fixture.sock', engineId: 'fixture-engine', create: vi.fn(() => { reached(); return new Promise<string>(resolve => { created = resolve; }); }),
    start: vi.fn(async () => {}), attachTerminal: vi.fn(async () => new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } })),
    remove: vi.fn(async () => ({ confirmed: false })) };
  const resources = { prepare: vi.fn(async () => {}), created: vi.fn(async () => {}), stopped: vi.fn(async () => {}) };
  const worker = new DesktopTerminalWorker({ engine: engine as unknown as DesktopContainerEngine, resources: resources as unknown as DesktopContainerResources,
    intent, workspaceId, ownerId, imageId: 'sha256:' + 'a'.repeat(64), binding: { sessionId: randomUUID(), generation: randomUUID(), connectionInstanceId: randomUUID() },
    ledger: { find: async () => undefined, record: async () => {}, finish: async () => {} }, current: () => true, emit: () => {} });
  const run = worker.run(args, new AbortController().signal), failed = expect(run).rejects.toThrow('AUTHORITY_INVALID');
  await creating; const stop = worker.stop(); created('a'.repeat(64));
  expect(await stop).toEqual({ confirmed: false }); await failed;
  expect(engine.start).not.toHaveBeenCalled(); expect(engine.attachTerminal).not.toHaveBeenCalled();
  expect(resources.stopped).not.toHaveBeenCalled();
  engine.remove.mockResolvedValue({ confirmed: true }); expect(await worker.stop()).toEqual({ confirmed: true });
  expect(resources.created).toHaveBeenCalledOnce(); expect(resources.stopped).toHaveBeenCalledOnce();
});

it.skipIf(process.env.XOPC_CONTAINER_LIVE !== '1')('keeps the root intent running while a real PTY is open and confirms stop only after removing its container', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-terminal-worker-')), key = randomBytes(32);
  const encryption = {
    available: async () => true,
    encrypt: async (text: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async (value: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(); },
  };
  const engine = await DesktopContainerEngine.connect(), imageId = await engine.resolveInstalledImage('node:26.12.1-bookworm-slim');
  const workspaceId = randomUUID(), ownerId = randomUUID(), volume = await engine.ensureWorkspace(ownerId, workspaceId);
  const args = { workspaceId, argv: ['/bin/sh'] }, binding = { sessionId: randomUUID(), generation: randomUUID(), connectionInstanceId: randomUUID() };
  const intent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), workspaceId, tool: 'desktop.terminal.open',
    argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex'), toolRevision: 'a'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 60000 };
  const lease = new DesktopExecutionLease(root), journal = new DesktopOperationJournal(lease), ledger = new DesktopTerminalLedger(lease, binding);
  const resources = new DesktopContainerResources(join(root, 'resources'), encryption), frames: Array<{ bytes: string; sequence: number }> = [];
  let current = true, emit: ((frame: DesktopTerminalOutput) => void) | undefined;
  const worker = new DesktopTerminalWorker({ engine, resources, intent, ownerId, workspaceId, imageId, binding, ledger, current: () => current, emit: frame => { emit!(frame); } });
  const supervisor = new DesktopOperationSupervisor({ journal, authority: () => ({ gatewayId: intent.gatewayId, deviceId: intent.deviceId, workspaceId,
    authorizationRevision: 1, toolRevision: intent.toolRevision, expiresAt: intent.expiresAt, active: current }), createWorker: () => worker });
  const scope = { ...binding, gatewayId: intent.gatewayId, deviceId: intent.deviceId, workspaceId, authorizationRevision: 1 };
  const confirmInput = vi.fn(async () => true);
  const broker = new DesktopTerminalBroker({ current: () => current, confirmOpen: async () => true, confirmInput,
    create: (_scope, _intent, callback) => { emit = callback; return { worker, supervisor }; }, emit: frame => { frames.push(frame); } });
  try {
    expect(await broker.open({ scope, intent, args, invocationId: randomUUID(), signal: new AbortController().signal })).toMatchObject({ ...binding, state: 'running', executionStopped: false });
    expect(journal.inspect(intent)).toMatchObject({ state: 'running', executionStopped: false });
    await broker.resize(scope, 100, 30);
    await expect(worker.resize({ ...binding, generation: randomUUID() }, 100, 30)).rejects.toThrow('BINDING_INVALID');
    const input = { ...binding, inputId: randomUUID(), sequence: 1, bytes: Buffer.from("printf x >> /home/node/count; printf 'WORKER_%s\\n' READY\r").toString('base64') };
    expect(await broker.input(scope, input, AbortSignal.timeout(5000))).toMatchObject({ dispatch: 'accepted' });
    expect(await broker.input(scope, input, AbortSignal.timeout(5000))).toMatchObject({ dispatch: 'accepted' });
    expect(confirmInput).toHaveBeenCalledTimes(2);
    const output = () => Buffer.concat(frames.map(frame => Buffer.from(frame.bytes, 'base64'))).toString();
    await vi.waitFor(() => expect(output()).toContain('WORKER_READY'), { timeout: 5000 });
    broker.acknowledge(scope, { ...binding, throughSequence: frames.at(-1)!.sequence });
    const record = await resources.load(intent); expect(record.phase).toBe('created');
    current = false;
    expect(await broker.stop()).toEqual({ confirmed: true });
    expect(journal.inspect(intent)?.executionStopped).toBe(true);
    expect(['stopped', 'unknown']).toContain(journal.inspect(intent)?.state);
    expect(await engine.inspect(record.containerId!, { ownerId, workspaceId, operationId: intent.operationId })).toBeUndefined();
    await expect(broker.input(scope, input, AbortSignal.timeout(1000))).rejects.toThrow('AUTHORITY_INVALID');
    expect(await resources.load(intent)).toMatchObject({ phase: 'stopped' });
    const repeated = await supervisor.execute({ intent, arguments: args, invocationId: randomUUID(), connectionInstanceId: randomUUID(), signal: new AbortController().signal }).catch(error => error);
    expect(repeated instanceof Error).toBe(true);
  } finally {
    expect(await worker.stop()).toEqual({ confirmed: true }); ledger.close(); journal.close(); lease.close();
    execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'volume', 'rm', volume], { stdio: 'ignore' }); await rm(root, { recursive: true, force: true });
  }
}, 30000);
