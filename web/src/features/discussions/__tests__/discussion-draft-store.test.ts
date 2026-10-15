// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDiscussionDraftChunk, listDiscussionDrafts, loadDiscussionDraftForRecovery, saveDiscussionDraft, saveDiscussionDraftChunk } from '../discussion-draft-store';
import type { DiscussionDraft } from '../discussion-types';

const draft: DiscussionDraft = { id: 'recording', mimeType: 'audio/webm', startedAt: 1, updatedAt: 1,
  state: 'recording', chunkCount: 0, durationMs: 0, lastSequence: -1 };
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const chunk = (index: number) => ({ draftId: draft.id, index, blob: new Blob([`audio-${index}`]), createdAt: index });

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('xopc-discussion-drafts');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

describe('atomic original audio commits', () => {
  it('reopens the committed prefix and metadata after an interrupted session', async () => {
    await saveDiscussionDraft(draft);
    for (let index = 0; index < 3; index++) await saveDiscussionDraftChunk(chunk(index), {
      ...draft, chunkCount: index + 1, durationMs: (index + 1) * 5_000,
    });
    expect(await loadDiscussionDraftForRecovery(draft.id)).toMatchObject({ chunkCount: 3, durationMs: 15_000, state: 'recording' });
    expect(await getDiscussionDraftChunk(draft.id, 2)).toBeDefined();
  });

  it('aborts the audio insert if metadata cloning fails, preserving the previous recovery boundary', async () => {
    await saveDiscussionDraft(draft);
    await saveDiscussionDraftChunk(chunk(0), { ...draft, chunkCount: 1, durationMs: 5_000 });
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'drafts') throw new DOMException('disk unavailable', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    await expect(saveDiscussionDraftChunk(chunk(1), { ...draft, chunkCount: 2, durationMs: 10_000 })).rejects.toThrow('disk unavailable');
    expect((await listDiscussionDrafts())[0]).toMatchObject({ chunkCount: 1, durationMs: 5_000 });
    expect(await getDiscussionDraftChunk(draft.id, 1)).toBeUndefined();
  });

  it('does not claim recovery is complete if a persisted audio chunk is missing', async () => {
    await saveDiscussionDraftChunk(chunk(0), { ...draft, chunkCount: 2 });
    await expect(loadDiscussionDraftForRecovery(draft.id)).rejects.toThrow('missing chunks');
    expect(await getDiscussionDraftChunk(draft.id, 0)).toBeDefined();
  });

  it('detects a hole even when the number of blobs matches the declared count', async () => {
    await saveDiscussionDraftChunk(chunk(0), { ...draft, chunkCount: 2 });
    await saveDiscussionDraftChunk(chunk(2));
    await expect(loadDiscussionDraftForRecovery(draft.id)).rejects.toThrow('missing chunks');
  });

  it('does not report an empty permission-stage session as recoverable audio', async () => {
    await saveDiscussionDraft(draft);
    await expect(loadDiscussionDraftForRecovery(draft.id)).rejects.toThrow('No audio was saved');
  });

  it('waits for transaction commit rather than the individual audio request', async () => {
    await saveDiscussionDraft(draft);
    const db = await database();
    const blocker = db.transaction('drafts', 'readwrite');
    blocker.objectStore('drafts').put({ ...draft, updatedAt: 2 });
    const saving = saveDiscussionDraftChunk(chunk(0), { ...draft, chunkCount: 1 });
    await saving; db.close();
    expect((await loadDiscussionDraftForRecovery(draft.id)).chunkCount).toBe(1);
  });
});
