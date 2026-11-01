import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson, type DesktopExecutionRequest } from '@xopcai/endpoint-tools-protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DesktopExecutionSession } from '../desktop/execution-session.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../desktop/operation-journal.js';
import { DesktopOperationSupervisor, type DesktopExecutionAuthority, type DesktopExecutionWorker } from '../desktop/operation-supervisor.js';

let root: string, lease: DesktopExecutionLease, journal: DesktopOperationJournal;
let authority: DesktopExecutionAuthority, worker: DesktopExecutionWorker, request: DesktopExecutionRequest;
let supervisor: DesktopOperationSupervisor, session: DesktopExecutionSession;
const confirm = vi.fn(async (_request: DesktopExecutionRequest, _signal: AbortSignal) => true);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xopc-execution-session-')); lease = new DesktopExecutionLease(root); journal = new DesktopOperationJournal(lease);
  authority = { gatewayId: randomUUID(), deviceId: randomUUID(), authorizationRevision: 2, toolRevision: 'a'.repeat(64), expiresAt: Date.now() + 60000, active: true };
  const args = { content: 'fixture' };
  request = { invocationId: randomUUID(), toolCallId: 'fixture', toolName: 'fixture.write', arguments: args,
    descriptorRevision: authority.toolRevision, confirmationRequired: true, deadlineAt: authority.expiresAt,
    execution: { operationId: randomUUID(), gatewayId: authority.gatewayId, deviceId: authority.deviceId, tool: 'fixture.write',
      argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex'), toolRevision: authority.toolRevision,
      authorizationRevision: authority.authorizationRevision, expiresAt: authority.expiresAt } };
  worker = { run: vi.fn(async () => ({ status: 'succeeded', result: { written: true } })), stop: vi.fn(async () => ({ confirmed: true })) };
  supervisor = new DesktopOperationSupervisor({ journal, authority: () => authority, createWorker: () => worker, stopTimeoutMs: 25 });
  confirm.mockReset().mockResolvedValue(true);
  session = new DesktopExecutionSession({ binding: { gatewayId: authority.gatewayId, deviceId: authority.deviceId,
    authorizationRevision: authority.authorizationRevision, clientId: randomUUID(), connectionInstanceId: randomUUID() }, supervisor, confirm });
});
afterEach(async () => { await session.close(); journal.close(); lease.close(); rmSync(root, { recursive: true, force: true }); });

it('requires separate confirmation and serves an existing receipt without re-executing or replaying its result body', async () => {
  expect(await session.invoke(request)).toMatchObject({ repeated: false, result: { written: true }, receipt: { state: 'succeeded', executionStopped: true } });
  const repeated = await session.invoke({ ...request, invocationId: randomUUID() });
  expect(repeated).toMatchObject({ repeated: true, receipt: { state: 'succeeded' } }); expect(repeated.result).toBeUndefined();
  expect(confirm).toHaveBeenCalledTimes(1); expect(worker.run).toHaveBeenCalledTimes(1);
});

it('rejects altered targets, revisions, deadlines and confirmation policy before native approval', async () => {
  for (const patch of [{ execution: { ...request.execution, gatewayId: randomUUID() } },
    { execution: { ...request.execution, deviceId: randomUUID() } }, { execution: { ...request.execution, authorizationRevision: 3 } },
    { toolName: 'other.write' }, { descriptorRevision: 'b'.repeat(64) }, { deadlineAt: request.deadlineAt + 1 }, { confirmationRequired: false }]) {
    await expect(session.invoke({ ...request, ...patch })).rejects.toThrow();
  }
  expect(confirm).not.toHaveBeenCalled(); expect(worker.run).not.toHaveBeenCalled();
});

it('can cancel or close during an unresolved approval without starting a worker or awaiting the dialog', async () => {
  confirm.mockImplementation(async () => new Promise(() => {}));
  const pending = session.invoke(request); const failure = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  await expect(session.cancel(request.invocationId)).rejects.toThrow(); await failure;
  expect(journal.inspect(request.execution)).toBeUndefined(); expect(worker.run).not.toHaveBeenCalled();
  const second = session.invoke({ ...request, invocationId: randomUUID() }); const stopped = expect(second).rejects.toThrow();
  expect(await session.close()).toEqual({ state: 'idle' }); await stopped;
  await expect(session.invoke(request)).rejects.toThrow('SESSION_CLOSED');
});

it('does not report cancellation as stopped until executor acknowledgement is durable', async () => {
  const started = Promise.withResolvers<void>(), stop = Promise.withResolvers<{ confirmed: boolean }>();
  worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); }); worker.stop = vi.fn(() => stop.promise);
  const pending = session.invoke(request); await started.promise;
  const cancellation = session.cancel(request.invocationId); let returned = false; void cancellation.then(() => { returned = true; });
  expect(journal.inspect(request.execution)).toMatchObject({ state: 'cancel-requested', executionStopped: false });
  await Promise.resolve(); expect(returned).toBe(false);
  stop.resolve({ confirmed: true });
  expect(await cancellation).toMatchObject({ receipt: { state: 'stopped', executionStopped: true } }); await pending;
});

it('retains unknown outcomes, blocks a new operation and ignores cancellation for another attempt', async () => {
  const started = Promise.withResolvers<void>(); worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); });
  worker.stop = vi.fn(async () => ({ confirmed: false }));
  const pending = session.invoke(request); await started.promise;
  expect(await session.cancel(randomUUID())).toBeUndefined(); expect(worker.stop).not.toHaveBeenCalled();
  expect(await session.cancel(request.invocationId)).toMatchObject({ receipt: { state: 'unknown', executionStopped: false } }); await pending;
  await expect(session.invoke({ ...request, invocationId: randomUUID(), execution: { ...request.execution, operationId: randomUUID() } })).rejects.toThrow('STOP_UNCONFIRMED');
  expect(worker.run).toHaveBeenCalledTimes(1);
});

it('copies the approved request and rechecks live authority after native approval', async () => {
  confirm.mockImplementation(async copied => { copied.arguments.content = 'changed'; authority.active = false; return true; });
  await expect(session.invoke(request)).rejects.toThrow('AUTHORITY_INVALID');
  expect(request.arguments.content).toBe('fixture'); expect(worker.run).not.toHaveBeenCalled();
});

it('waits for a durable terminal receipt before close permits the journal owner to tear down', async () => {
  const started = Promise.withResolvers<void>();
  worker.run = vi.fn(async () => { started.resolve(); return new Promise(() => {}); });
  const pending = session.invoke(request); await started.promise;
  expect(await session.close()).toEqual({ state: 'stopped', resultUnknown: true });
  expect(journal.inspect(request.execution)).toMatchObject({ state: 'stopped', executionStopped: true });
  expect(await pending).toMatchObject({ receipt: { state: 'stopped' } });
});
