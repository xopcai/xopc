// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDiscussionDraftChunk, listDiscussionDrafts, loadDiscussionDraftForRecovery, saveDiscussionDraft, saveDiscussionDraftChunk } from '../discussion-draft-store';
import { mediaHeader, mediaCluster } from './recording-media-fixture';
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
  it('never overwrites an immutable audio chunk during competing recovery attempts', async () => {
    await saveDiscussionDraft(draft);
    await saveDiscussionDraftChunk(chunk(0), { ...draft, chunkCount: 1 });
    await expect(saveDiscussionDraftChunk({ ...chunk(0), blob: new Blob(['replacement']) }, { ...draft, chunkCount: 2 })).rejects.toThrow();
    expect(await loadDiscussionDraftForRecovery(draft.id)).toMatchObject({ chunkCount: 1 });
  });

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

  it.each([40, 41])('rechecks retained audio instead of trusting an old gap proof (next timestamp %i)', async timestamp => {
    vi.stubGlobal('Blob', NodeBlob);
    const parts = [new Blob([Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(19)])]),
      new Blob([Uint8Array.from([...mediaCluster(timestamp), ...mediaCluster(60)])])];
    const old = { ...draft, chunkCount: 2, durationMs: 80, serverDiscussionId: 'same-note',
      mediaCoverage: { version: 1 as const, verifiedThroughMs: 20, observedThroughMs: 80, status: 'gap' as const, committedChunkCount: 2 } };
    for (let index = 0; index < parts.length; index++) await saveDiscussionDraftChunk({ ...chunk(index), blob: parts[index] }, old);
    const recovered = await loadDiscussionDraftForRecovery(draft.id);
    expect(recovered).toMatchObject({ id: draft.id, serverDiscussionId: 'same-note', chunkCount: 2, saveOutcome: 'interrupted',
      mediaCoverage: { status: timestamp === 40 ? 'verified' : 'gap', verifiedThroughMs: timestamp === 40 ? 80 : 39 } });
    for (let index = 0; index < parts.length; index++) {
      expect(await (await getDiscussionDraftChunk(draft.id, index))!.blob.arrayBuffer()).toEqual(await parts[index].arrayBuffer());
    }
  });

  it('rechecks each resumed epoch without joining across the interruption', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const epoch = (last: number) => new Blob([Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(19), ...mediaCluster(last)])]);
    const old: DiscussionDraft = { ...draft, chunkCount: 2, durationMs: 120,
      epochs: [{ firstChunk: 0, mimeType: 'audio/webm', startedAt: 1, savedThroughMs: 20 },
        { firstChunk: 1, mimeType: 'audio/webm', startedAt: 1000, previousEndedAt: 500 }],
      mediaCoverage: { version: 1, verifiedThroughMs: 20, observedThroughMs: 61, status: 'gap', committedChunkCount: 2 } };
    await saveDiscussionDraftChunk({ ...chunk(0), blob: epoch(40) }, old);
    await saveDiscussionDraftChunk({ ...chunk(1), blob: epoch(41) }, old);
    const recovered = await loadDiscussionDraftForRecovery(draft.id);
    expect(recovered.epochs![0]).toMatchObject({ savedThroughMs: 60 });
    expect(recovered.epochs![1]).toEqual(old.epochs![1]);
    expect(recovered.mediaCoverage).toMatchObject({ status: 'gap', verifiedThroughMs: 39, observedThroughMs: 61 });
    const { verifiedSavedThrough } = await import('../recording-status');
    expect(verifiedSavedThrough(recovered)).toBe(60);
  });

  it('retains earlier audio when a resumed epoch crashed before producing its first packet', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const old: DiscussionDraft = { ...draft, chunkCount: 1, durationMs: 60,
      epochs: [{ firstChunk: 0, mimeType: 'audio/webm', startedAt: 1, savedThroughMs: 20 },
        { firstChunk: 1, mimeType: 'audio/webm', startedAt: 1000, previousEndedAt: 500 }] };
    await saveDiscussionDraftChunk({ ...chunk(0), blob: new Blob([Uint8Array.from([...mediaHeader, ...mediaCluster(0), ...mediaCluster(19), ...mediaCluster(40)])]) }, old);
    const recovered = await loadDiscussionDraftForRecovery(draft.id);
    expect(recovered.epochs![0].savedThroughMs).toBe(60);
    expect(recovered.mediaCoverage).toMatchObject({ status: 'unknown', verifiedThroughMs: 0 });
    expect(recovered.saveOutcome).toBe('interrupted');
    expect(await getDiscussionDraftChunk(draft.id, 0)).toBeDefined();
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
  it('downgrades an interrupted session and an inconsistent media proof without losing its original bytes', async () => {
    await saveDiscussionDraftChunk(chunk(0), { ...draft, chunkCount: 1, durationMs: 90_000,
      mediaCoverage: { version: 1, verifiedThroughMs: 5_000, observedThroughMs: 5_000, status: 'verified', committedChunkCount: 2 } });
    expect(await loadDiscussionDraftForRecovery(draft.id)).toMatchObject({ saveOutcome: 'interrupted', mediaCoverage: undefined });
    expect(await getDiscussionDraftChunk(draft.id, 0)).toBeDefined();
  });
});
