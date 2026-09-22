import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CapabilityDispatcher, CapabilityError, defineAtomicCapability, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { localAppCapabilities } from '../capabilities/runtime.js';

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'xopc-app-binding-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') }); });
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  let granted = true;
  let releaseId = 'release-1';
  const execute = vi.fn(() => ({ ok: true }));
  const afterCommit = vi.fn();
  const dispatcher = new CapabilityDispatcher();
  dispatcher.register(defineAtomicCapability({ id: 'xopc.notes.create', majorVersion: 1, description: 'Fixture', effect: 'local-write',
    surfaces: ['extension'], scopes: ['workspace.write'], input: z.strictObject({ title: z.string() }), output: z.object({ ok: z.boolean() }), execute, afterCommit }));
  const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['workspace.write'], authorize: () => true };
  const descriptor = dispatcher.describe('xopc.notes.create', { ...caller, surface: 'extension' });
  const binding = { id: 'xopc.notes.create' as const, majorVersion: descriptor.majorVersion, descriptorDigest: descriptor.descriptorDigest };
  const apps = { getCapabilityAccess: () => { if (!granted) throw new CapabilityError('FORBIDDEN', 'Revoked'); return { releaseId, bindings: [binding] }; } };
  const runtime = (extensionId = 'app', context = caller) => localAppCapabilities(apps, dispatcher, extensionId, 'b'.repeat(64), context);
  const call = { majorVersion: binding.majorVersion, descriptorDigest: binding.descriptorDigest, input: { title: 'Fixture' }, idempotencyKey: 'intent' };
  return { runtime, call, caller, execute, afterCommit, revoke: () => { granted = false; }, restore: () => { granted = true; }, upgrade: () => { releaseId = 'release-2'; } };
}
describe('Local App writes', () => {
  it('replays the same intent once and isolates keys across apps and releases', async () => {
    const f = fixture();
    await f.runtime().call('xopc.notes.create', f.call);
    await f.runtime().call('xopc.notes.create', f.call);
    expect(f.execute).toHaveBeenCalledTimes(1);
    await f.runtime('other-app').call('xopc.notes.create', f.call);
    const stale = f.runtime(); f.upgrade();
    await expect(stale.call('xopc.notes.create', f.call)).rejects.toMatchObject({ code: 'CONTRACT_CHANGED' });
    await f.runtime().call('xopc.notes.create', f.call);
    expect(f.execute).toHaveBeenCalledTimes(3);
  });
  it('rejects missing keys, caller scope restrictions and delegation narrowing', async () => {
    const f = fixture();
    await expect(f.runtime().call('xopc.notes.create', { ...f.call, idempotencyKey: undefined })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    for (const context of [{ ...f.caller, scopes: [] }, { ...f.caller, allowedCapabilities: [] }]) {
      await expect(f.runtime('app', context).call('xopc.notes.create', f.call)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('checks release authorization after asynchronous caller authorization', async () => {
    const f = fixture();
    await expect(f.runtime('app', { ...f.caller, authorize: async () => { f.revoke(); return true; } })
      .call('xopc.notes.create', f.call)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('reports committed-but-withheld writes as unknown and replays only the original intent', async () => {
    const f = fixture(); f.afterCommit.mockImplementationOnce(f.revoke);
    await expect(f.runtime().call('xopc.notes.create', f.call)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    f.restore();
    await expect(f.runtime().call('xopc.notes.create', f.call)).resolves.toMatchObject({ status: 'succeeded' });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
});
