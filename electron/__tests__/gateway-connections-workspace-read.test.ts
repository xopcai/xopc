import { randomUUID } from 'node:crypto';

import { desktopWorkspaceDescriptor } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';

import { DesktopExecutionCatalog } from '../desktop/execution-catalog.js';
import { DesktopWorkspaceReadSession, type DesktopWorkspaceReadApproval } from '../desktop/workspace-read-session.js';
import { EndpointToolPolicy } from '../../src/endpoint-tools/policy.js';
import { desktopExecutionGrantSchema } from '@xopcai/gateway-contract';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const workspaceId = randomUUID(), descriptor = desktopWorkspaceDescriptor('read', workspaceId), catalog = new DesktopExecutionCatalog([descriptor]);
  let current = true;
  const confirm = vi.fn(async (_request: DesktopWorkspaceReadApproval, _signal: AbortSignal) => true), worker = { run: vi.fn(async () => ({ status: 'succeeded' as const,
    result: { content: [{ type: 'json', value: { ok: true, result: { text: 'fixture', version: 'a'.repeat(64), bytes: 7 } } }] } })), stop: vi.fn(async () => ({ confirmed: true })) };
  const createWorker = vi.fn(() => worker), onExecutorStopped = vi.fn();
  const session = new DesktopWorkspaceReadSession({ gatewayId: randomUUID(), deviceId: randomUUID(), workspaceId, expiresAt: Date.now() + 120000,
    catalog, foreground: () => current, confirm, createWorker, onExecutorStopped });
  const request = { invocationId: randomUUID(), toolName: descriptor.name, descriptorRevision: catalog.revision(descriptor.name)!,
    arguments: { workspaceId, relativePath: 'file.txt' }, deadlineAt: Date.now() + 60000 };
  return { session, request, worker, confirm, createWorker, onExecutorStopped, invalidate: () => { current = false; }, restore: () => { current = true; } };
}
it('pins all workspace schemas and requires a workspace-bound grant without clipboard authority', () => {
  const policy = new EndpointToolPolicy(), workspaceId = randomUUID();
  for (const action of ['read', 'list', 'write'] as const) expect(() => policy.validateDescriptor('desktop', desktopWorkspaceDescriptor(action, workspaceId))).not.toThrow();
  const grant = { version: 1, grantId: randomUUID(), localApprovalId: randomUUID(), expiresAt: Date.now() + 60000, toolRevisions: { 'desktop.workspace.write': 'a'.repeat(64) } };
  expect(desktopExecutionGrantSchema.safeParse(grant).success).toBe(false);
  expect(desktopExecutionGrantSchema.safeParse({ ...grant, workspaceId }).success).toBe(true);
  expect(desktopExecutionGrantSchema.safeParse({ ...grant, workspaceId, toolRevisions: { ...grant.toolRevisions, 'desktop.clipboard.write': 'b'.repeat(64) } }).success).toBe(false);
});
it('never reads before native consent or after workspace/foreground authority changes', async () => {
  const f = fixture();
  await expect(f.session.invoke({ ...f.request, arguments: { ...f.request.arguments, workspaceId: randomUUID() } })).rejects.toThrow('AUTHORITY_INVALID');
  expect(f.confirm).not.toHaveBeenCalled();
  f.confirm.mockResolvedValueOnce(false);
  await expect(f.session.invoke(f.request)).rejects.toThrow('USER_DENIED'); expect(f.createWorker).not.toHaveBeenCalled();
  const approval = deferred<boolean>(); f.confirm.mockImplementationOnce(() => approval.promise);
  const pending = f.session.invoke(f.request); f.invalidate(); approval.resolve(true);
  await expect(pending).rejects.toThrow('AUTHORITY_INVALID'); expect(f.createWorker).not.toHaveBeenCalled();
  await f.session.close();
});
it('cancels a native approval without allowing a late response to start a read', async () => {
  const f = fixture(), approval = deferred<boolean>(); f.confirm.mockImplementationOnce(() => approval.promise);
  const pending = f.session.invoke(f.request), rejected = expect(pending).rejects.toThrow('CANCELLED');
  expect(await f.session.close()).toEqual({ state: 'stopped' }); await rejected;
  approval.resolve(true); await Promise.resolve(); expect(f.createWorker).not.toHaveBeenCalled();
});
it('allows a native sheet to own focus while approval is pending and rechecks foreground before reading', async () => {
  vi.useFakeTimers();
  const f = fixture(), approval = deferred<boolean>(); f.confirm.mockImplementationOnce(() => approval.promise);
  try {
    const pending = f.session.invoke(f.request); f.invalidate();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.confirm.mock.calls[0][1].aborted).toBe(false); expect(f.createWorker).not.toHaveBeenCalled();
    f.restore(); approval.resolve(true);
    expect(await pending).toMatchObject({ content: [{ type: 'json' }] }); expect(f.createWorker).toHaveBeenCalledOnce();
    await f.session.close();
  } finally { vi.useRealTimers(); }
});
it('stops an actual read when foreground is lost after approval and refuses another read on the stopped executor', async () => {
  vi.useFakeTimers();
  const f = fixture(), started = deferred<boolean>(), completion = deferred<Awaited<ReturnType<typeof f.worker.run>>>();
  f.worker.run.mockImplementationOnce(() => { started.resolve(true); return completion.promise; });
  try {
    const pending = f.session.invoke(f.request), rejected = expect(pending).rejects.toThrow('CANCELLED'); await started.promise;
    f.invalidate(); await vi.advanceTimersByTimeAsync(251); await rejected;
    expect(f.worker.stop).toHaveBeenCalledOnce(); expect(f.onExecutorStopped).toHaveBeenCalledOnce();
    f.restore(); await expect(f.session.invoke(f.request)).rejects.toThrow('AUTHORITY_INVALID'); await f.session.close();
  } finally { vi.useRealTimers(); }
});
it('returns only validated content and closes an in-flight native read only after executor confirmation', async () => {
  const f = fixture();
  expect(await f.session.invoke(f.request)).toMatchObject({ content: [{ type: 'json', value: { result: { text: 'fixture' } } }] });
  const running = deferred<Awaited<ReturnType<typeof f.worker.run>>>(), started = deferred<boolean>();
  f.worker.run.mockImplementationOnce(() => { started.resolve(true); return running.promise; });
  f.worker.stop.mockResolvedValueOnce({ confirmed: false });
  const pending = f.session.invoke({ ...f.request, invocationId: randomUUID() }), rejected = expect(pending).rejects.toThrow('CANCELLED'); await started.promise;
  expect(await f.session.close()).toEqual({ state: 'unknown' }); await rejected;
  expect(await f.session.close()).toEqual({ state: 'stopped' });
  running.resolve({ status: 'succeeded', result: { content: [] } }); await Promise.resolve();
  await expect(f.session.invoke(f.request)).rejects.toThrow('AUTHORITY_INVALID');
});
