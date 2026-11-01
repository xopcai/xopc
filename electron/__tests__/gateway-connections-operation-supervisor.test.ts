import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson } from '@xopcai/endpoint-tools-protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DesktopExecutionLease, DesktopOperationJournal, type DesktopOperationIntent } from '../desktop/operation-journal.js';
import { DesktopOperationSupervisor, type DesktopExecutionAuthority, type DesktopExecutionWorker } from '../desktop/operation-supervisor.js';

let directory: string, lease: DesktopExecutionLease, journal: DesktopOperationJournal, authority: DesktopExecutionAuthority;
let operation: DesktopOperationIntent, worker: DesktopExecutionWorker;
const args = { relativePath: 'fixture.txt', content: 'fixture' };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-execution-supervisor-')); lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  authority = { gatewayId: randomUUID(), deviceId: randomUUID(), authorizationRevision: 1, toolRevision: 'b'.repeat(64), expiresAt: Date.now() + 60000, active: true };
  operation = { operationId: randomUUID(), ...authority, tool: 'fixture.write', argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex') };
  delete (operation as unknown as Record<string, unknown>).active;
  worker = { run: vi.fn(async () => ({ status: 'succeeded', result: { written: true } })), stop: vi.fn(async () => ({ confirmed: true })) };
});
afterEach(() => { journal.close(); lease.close(); rmSync(directory, { recursive: true, force: true }); });
const request = (intent = operation) => ({ intent, arguments: { ...args }, invocationId: randomUUID(), connectionInstanceId: randomUUID(), signal: new AbortController().signal });
const create = () => new DesktopOperationSupervisor({ journal, authority: () => authority, createWorker: () => worker, stopTimeoutMs: 25 });

it('commits intent before work, records the result and serves duplicate receipts without executing again', async () => {
  worker.run = vi.fn(async () => {
    expect(journal.inspect(operation)?.state).toBe('running'); return { status: 'succeeded', result: { written: true } };
  });
  const supervisor = create(); const first = await supervisor.execute(request());
  expect(first).toMatchObject({ repeated: false, result: { written: true }, receipt: { state: 'succeeded' } });
  expect(await supervisor.execute(request())).toMatchObject({ repeated: true, receipt: first.receipt });
  expect(worker.run).toHaveBeenCalledTimes(1);
});

it('rejects mismatched authority and arguments before a worker can execute', async () => {
  const supervisor = create();
  await expect(supervisor.execute({ ...request(), intent: { ...operation, deviceId: randomUUID() } })).rejects.toThrow('AUTHORITY_INVALID');
  await expect(supervisor.execute({ ...request(), arguments: { ...args, content: 'changed' } })).rejects.toThrow('ARGUMENT_MISMATCH');
  await expect(supervisor.execute({ ...request(), intent: { ...operation, workspaceId: randomUUID() } })).rejects.toThrow('AUTHORITY_INVALID');
  expect(worker.run).not.toHaveBeenCalled(); expect(journal.inspect(operation)).toBeUndefined();
});

it('takes an immutable copy of the verified arguments before the asynchronous worker starts', async () => {
  const supervisor = create(), input = request(); const pending = supervisor.execute(input); input.arguments.content = 'changed';
  await pending; expect(worker.run).toHaveBeenCalledWith(args, expect.any(AbortSignal));
});

it('does not confuse an abort request with confirmed executor termination', async () => {
  const started = Promise.withResolvers<void>(), released = Promise.withResolvers<{ status: 'succeeded'; result: unknown }>();
  worker.run = vi.fn(async () => { started.resolve(); return released.promise; });
  worker.stop = vi.fn(async () => ({ confirmed: false }));
  const supervisor = create(), controller = new AbortController(), pending = supervisor.execute({ ...request(), signal: controller.signal });
  await started.promise; controller.abort();
  expect(await pending).toMatchObject({ receipt: { state: 'unknown' } });
  expect(supervisor.status().blocked).toBe(true);
  await expect(supervisor.execute(request({ ...operation, operationId: randomUUID() }))).rejects.toThrow('STOP_UNCONFIRMED');
  released.resolve({ status: 'succeeded', result: 'late' }); await Promise.resolve();
  expect(journal.inspect(operation)?.state).toBe('unknown');
});

it('supports a local stop independently of the remote signal and records executor confirmation', async () => {
  const started = Promise.withResolvers<void>(); worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); });
  const supervisor = create(), pending = supervisor.execute(request()); await started.promise;
  expect(await supervisor.stop()).toEqual({ state: 'stopped' });
  expect(await pending).toMatchObject({ receipt: { state: 'stopped' } });
  expect(worker.stop).toHaveBeenCalledTimes(1);
});

it('bounds a hung stop and prevents takeover when confirmation is missing', async () => {
  const started = Promise.withResolvers<void>(); worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); });
  worker.stop = vi.fn(async () => new Promise(() => {}));
  const supervisor = create(), pending = supervisor.execute(request()); await started.promise;
  expect(await supervisor.stop()).toEqual({ state: 'unknown' });
  expect(await pending).toMatchObject({ receipt: { state: 'unknown' } });
});

it('retains an unconfirmed executor for a later local stop without turning unknown into success', async () => {
  const started = Promise.withResolvers<void>(); worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); });
  worker.stop = vi.fn().mockResolvedValueOnce({ confirmed: false }).mockResolvedValue({ confirmed: true });
  const supervisor = create(), pending = supervisor.execute(request()); await started.promise;
  expect(await supervisor.stop()).toEqual({ state: 'unknown' }); await pending;
  expect(supervisor.status().stopUnconfirmed).toBe(true);
  expect(await supervisor.stop()).toEqual({ state: 'stopped', resultUnknown: true });
  expect(supervisor.inspect(operation)).toMatchObject({ state: 'unknown', executionStopped: true });
  expect(supervisor.status().blocked).toBe(true);
  await expect(supervisor.execute(request({ ...operation, operationId: randomUUID() }))).rejects.toThrow('STOP_UNCONFIRMED');
});

it('uses a watchdog to stop expired work without waiting for the network', async () => {
  worker.run = vi.fn(async () => new Promise(() => {})); const supervisor = create();
  operation.expiresAt = Date.now() + 50;
  expect(await supervisor.execute(request())).toMatchObject({ receipt: { state: 'stopped' } });
  expect(worker.stop).toHaveBeenCalledOnce();
});

it('stops work after local authority revocation', async () => {
  const started = Promise.withResolvers<void>(); worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); });
  const supervisor = create(), pending = supervisor.execute(request()); await started.promise; authority.active = false;
  expect(await pending).toMatchObject({ receipt: { state: 'stopped' } });
});

it('blocks new execution after a process restart leaves an unresolved operation', async () => {
  journal.record(operation); journal.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() });
  journal.close(); lease.close(); lease = new DesktopExecutionLease(directory); journal = new DesktopOperationJournal(lease);
  const supervisor = create();
  expect(await supervisor.execute(request())).toMatchObject({ repeated: true, receipt: { state: 'unknown' } });
  await expect(supervisor.execute(request({ ...operation, operationId: randomUUID() }))).rejects.toThrow('STOP_UNCONFIRMED');
  expect(worker.run).not.toHaveBeenCalled();
});

it('allows receipt verification after the execution deadline, but rejects another device and a second supervisor', async () => {
  const supervisor = create(); await supervisor.execute(request());
  expect(() => create()).toThrow('DESKTOP_SUPERVISOR_ALREADY_ATTACHED');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(operation.expiresAt + 1);
  authority.expiresAt = operation.expiresAt + 60000;
  try { expect(supervisor.inspect(operation)?.state).toBe('succeeded'); } finally { clock.mockRestore(); }
  authority.deviceId = randomUUID();
  expect(() => supervisor.inspect(operation)).toThrow('AUTHORITY_INVALID');
});
