import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getUnderstandingSourceRun, revokeUnderstandingSourceGrant, upsertUnderstandingSourceGrant } from '../repository.js';
import { UnderstandingRefreshService, type UnderstandingRefreshDeps } from '../refresh-service.js';

function grant(adapterId = 'apple-notes') {
  return upsertUnderstandingSourceGrant({ sourceKey: adapterId, adapterId, category: 'notes', platform: 'darwin',
    displayName: adapterId, accessMode: 'once', retentionPolicy: 'derived_only', processingPolicy: 'remote_allowed', config: {} });
}
function service(overrides: Partial<UnderstandingRefreshDeps> = {}) {
  const deps: UnderstandingRefreshDeps = { enabled: () => true,
    start: vi.fn(async () => ({ phase: 'waiting_desktop' })), progress: () => undefined,
    analyzeDesktop: vi.fn(async () => ({ added: 0, updated: 0 })), ...overrides };
  return { refresh: new UnderstandingRefreshService(deps), deps };
}

describe('manual understanding refresh', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  it('reuses an active source run across batches and analyzes unchanged items again after completion', async () => {
    const source = grant();
    const { refresh, deps } = service();
    const first = refresh.start([source.id]);
    await Promise.resolve();
    const repeated = refresh.start([source.id]);
    expect(first.sources[0].id).toBe(repeated.sources[0].id);
    expect(deps.start).toHaveBeenCalledTimes(1);
    const items = [{ sourceId: 'apple-notes', id: 'unchanged' } as never];
    refresh.submitDesktop(first.sources[0].id, { items });
    await vi.waitFor(() => expect(refresh.get(first.id)?.status).toBe('completed'));
    expect(refresh.get(first.id)?.status).toBe('completed');
    const next = refresh.start([source.id]);
    expect(next.sources[0].id).not.toBe(first.sources[0].id);
    await Promise.resolve();
    refresh.submitDesktop(next.sources[0].id, { items });
    await vi.waitFor(() => expect(refresh.get(next.id)?.status).toBe('completed'));
    expect(deps.analyzeDesktop).toHaveBeenCalledTimes(2);
    expect(refresh.sources()[0].id).toBe(next.sources[0].id);
  });

  it('preserves successful sources when another source fails', async () => {
    const one = grant(); const two = grant('apple-mail');
    const { refresh } = service();
    const batch = refresh.start([one.id, two.id]);
    await Promise.resolve();
    refresh.submitDesktop(batch.sources[0].id, { items: [] });
    refresh.submitDesktop(batch.sources[1].id, { items: [], error: 'Permission denied' });
    expect(refresh.get(batch.id)?.status).toBe('partial');
  });

  it('marks interrupted desktop work as failed and allows explicit retry', async () => {
    const source = grant(); const first = service();
    const batch = first.refresh.start([source.id]);
    await Promise.resolve();
    const restarted = service();
    expect(restarted.refresh.get(batch.id)?.status).toBe('failed');
    expect(restarted.refresh.start([source.id]).sources[0].id).not.toBe(batch.sources[0].id);
    await Promise.resolve();
  });

  it('rejects revoked sources and foreign desktop items without running analysis', async () => {
    const source = grant(); const { refresh, deps } = service();
    const batch = refresh.start([source.id]);
    await Promise.resolve();
    expect(() => refresh.submitDesktop(batch.sources[0].id, { items: [{ sourceId: 'apple-mail' } as never] })).toThrow('requested source');
    revokeUnderstandingSourceGrant(source.id);
    expect(refresh.get(batch.id)?.sources[0].status).toBe('canceled');
    expect(deps.analyzeDesktop).not.toHaveBeenCalled();
    expect(() => refresh.start([source.id])).toThrow('authorized');
  });

  it('stores start failures so clients never remain stuck in reading', async () => {
    const source = grant();
    const { refresh } = service({ start: async () => { throw new Error('Reconnect source'); } });
    const batch = refresh.start([source.id]);
    await vi.waitFor(() => expect(refresh.get(batch.id)?.status).toBe('failed'));
    expect(getUnderstandingSourceRun(batch.sources[0].id)?.errorMessage).toBe('Reconnect source');
  });
});
