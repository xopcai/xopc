// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.fetch }));
import { acknowledgeLocalAnnotation, listLocalAnnotations, newAnnotation, saveLocalAnnotation } from '../discussion-annotation-store';
import { syncDiscussionAnnotations } from '../discussion-annotation-sync';
beforeEach(() => { vi.stubGlobal('indexedDB',new IDBFactory()); vi.stubGlobal('IDBKeyRange',IDBKeyRange); mocks.fetch.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
it('keeps one stable highlight through offline failure and a lost successful response', async () => {
  const mark = newAnnotation({ type: 'time',capturedAt: 1,positionMs: 1000 });
  await saveLocalAnnotation('recording',mark);
  mocks.fetch.mockRejectedValueOnce(new Error('OFFLINE'));
  await expect(syncDiscussionAnnotations('recording','discussion')).rejects.toThrow('OFFLINE');
  expect((await listLocalAnnotations('recording'))[0]).toMatchObject({ state: 'pending',annotation: { id: mark.id } });
  mocks.fetch.mockRejectedValueOnce(new Error('RESPONSE_LOST')).mockResolvedValue({ ...mark,revision: 1 });
  await expect(syncDiscussionAnnotations('recording','discussion')).rejects.toThrow('RESPONSE_LOST');
  await syncDiscussionAnnotations('recording','discussion');
  expect(await listLocalAnnotations('recording')).toHaveLength(1);
  expect((await listLocalAnnotations('recording'))[0]).toMatchObject({ state: 'synced',annotation: { revision: 1 } });
  const ids = mocks.fetch.mock.calls.map(call => JSON.parse(call[1].body).id); expect(new Set(ids).size).toBe(1);
});
it('does not erase a new local edit when an earlier save acknowledgement arrives', async () => {
  const mark = newAnnotation({ type: 'transcript',capturedAt: 1,transcriptRevision: 7,segmentIds: [4] });
  await saveLocalAnnotation('recording',mark); const row = (await listLocalAnnotations('recording'))[0];
  await saveLocalAnnotation('recording',{ ...mark,text: 'New local thought' });
  await acknowledgeLocalAnnotation(row,{ ...mark,revision: 1 });
  expect((await listLocalAnnotations('recording'))[0]).toMatchObject({ state: 'pending',annotation: { text: 'New local thought',revision: 1 } });
});
it('keeps local edits and a conflict state instead of overwriting remote changes', async () => {
  const mark = newAnnotation({ type: 'time',capturedAt: 1,positionMs: 1000 });
  await saveLocalAnnotation('recording',{ ...mark,text: 'My local context' });
  mocks.fetch.mockRejectedValue(Object.assign(new Error('Conflict'),{ status: 409 }));
  await expect(syncDiscussionAnnotations('recording','discussion')).rejects.toThrow('Conflict');
  expect((await listLocalAnnotations('recording'))[0]).toMatchObject({ state: 'conflict',annotation: { text: 'My local context' } });
  await syncDiscussionAnnotations('recording','discussion'); expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it('rejects a stale editor in another tab before overwriting a newer unsynced edit', async () => {
  const mark = newAnnotation({ type: 'time',capturedAt: 1,positionMs: 1000 }); await saveLocalAnnotation('recording',mark);
  const first = (await listLocalAnnotations('recording'))[0];
  await saveLocalAnnotation('recording',{ ...mark,text: 'First tab edit' },first.nonce);
  await expect(saveLocalAnnotation('recording',{ ...mark,text: 'Second stale editor' },first.nonce)).rejects.toThrow('another tab');
  expect((await listLocalAnnotations('recording'))[0].annotation.text).toBe('First tab edit');
});

it('drains a new local edit that arrives while the first server acknowledgement is pending', async () => {
  const mark = newAnnotation({ type: 'time',capturedAt: 1,positionMs: 1000 }); await saveLocalAnnotation('recording',mark);
  let finish!: (value: unknown) => void;
  mocks.fetch.mockImplementationOnce(() => new Promise(done => { finish = done; })).mockImplementation(async (_url,options) => ({ ...mark,...JSON.parse(options.body),revision: 2 }));
  const syncing = syncDiscussionAnnotations('recording','discussion'); await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  await saveLocalAnnotation('recording',{ ...mark,text: 'Edit while syncing' }); finish({ ...mark,revision: 1 }); await syncing;
  expect(mocks.fetch).toHaveBeenCalledTimes(2); expect((await listLocalAnnotations('recording'))[0]).toMatchObject({ state: 'synced',annotation: { text: 'Edit while syncing',revision: 2 } });
});
