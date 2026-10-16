import type { DiscussionDraft, DiscussionDraftChunk, DiscussionLiveSegment } from './discussion-types';
import { verifiedSavedThrough } from './recording-status';
import { RecordingMediaCoverageReader } from './recording-media-coverage';

const DATABASE_NAME = 'xopc-discussion-drafts';
const DATABASE_VERSION = 2;
const DRAFTS = 'drafts';
const CHUNKS = 'chunks';
const SEGMENTS = 'segments';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

function openDraftDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local recording storage is unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const chunks = db.createObjectStore(CHUNKS, { keyPath: ['draftId', 'index'] });
        chunks.createIndex('draftId', 'draftId');
      }
      if (!db.objectStoreNames.contains(SEGMENTS)) {
        const segments = db.createObjectStore(SEGMENTS, { keyPath: ['draftId', 'sequence'] });
        segments.createIndex('draftId', 'draftId');
      }

    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local recording storage'));
  });
}

export async function saveDiscussionDraft(draft: DiscussionDraft): Promise<void> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(DRAFTS, 'readwrite', { durability: 'strict' });
    transaction.objectStore(DRAFTS).put(draft);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function saveDiscussionDraftChunk(chunk: DiscussionDraftChunk, draft?: DiscussionDraft): Promise<void> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(draft ? [CHUNKS, DRAFTS] : [CHUNKS], 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    try {
      transaction.objectStore(CHUNKS).add(chunk);
      if (draft) transaction.objectStore(DRAFTS).put(draft);
      await done;
    } catch (error) {
      try { transaction.abort(); } catch { /* Already aborted by the storage engine. */ }
      await done.catch(() => undefined);
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function listDiscussionDrafts(): Promise<DiscussionDraft[]> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(DRAFTS, 'readonly');
    const done = transactionDone(transaction);
    const drafts = await requestResult(transaction.objectStore(DRAFTS).getAll()) as DiscussionDraft[];
    await done;
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function getDiscussionDraftChunk(draftId: string, index: number): Promise<DiscussionDraftChunk | undefined> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(CHUNKS, 'readonly');
    const done = transactionDone(transaction);
    const chunk = await requestResult(transaction.objectStore(CHUNKS).get([draftId, index])) as DiscussionDraftChunk | undefined;
    await done;
    return chunk;
  } finally { db.close(); }
}

export async function saveDiscussionLiveSegment(segment: DiscussionLiveSegment): Promise<void> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(SEGMENTS, 'readwrite');
    transaction.objectStore(SEGMENTS).put(segment);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function listDiscussionLiveSegments(draftId: string): Promise<DiscussionLiveSegment[]> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(SEGMENTS, 'readonly');
    const done = transactionDone(transaction);
    const segments = await requestResult(
      transaction.objectStore(SEGMENTS).index('draftId').getAll(draftId),
    ) as DiscussionLiveSegment[];
    await done;
    return segments.sort((a, b) => a.sequence - b.sequence);
  } finally {
    db.close();
  }
}

export async function deleteDiscussionLiveSegment(draftId: string, sequence: number): Promise<void> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(SEGMENTS, 'readwrite');
    transaction.objectStore(SEGMENTS).delete([draftId, sequence]);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function deleteDiscussionDraft(draftId: string): Promise<void> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction([DRAFTS, CHUNKS, SEGMENTS], 'readwrite');
    transaction.objectStore(DRAFTS).delete(draftId);
    const chunkStore = transaction.objectStore(CHUNKS);
    const cursorRequest = chunkStore.index('draftId').openKeyCursor(IDBKeyRange.only(draftId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      chunkStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    const segmentStore = transaction.objectStore(SEGMENTS);
    const segmentCursor = segmentStore.index('draftId').openKeyCursor(IDBKeyRange.only(draftId));
    segmentCursor.onsuccess = () => {
      const cursor = segmentCursor.result;
      if (!cursor) return;
      segmentStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

/** Verify committed chunk keys; recheck old gap and resumed-epoch proofs with bounded memory. */
export async function loadDiscussionDraftForRecovery(id: string): Promise<DiscussionDraft> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction([DRAFTS, CHUNKS], 'readonly');
    const done = transactionDone(transaction);
    const draftRequest = transaction.objectStore(DRAFTS).get(id) as IDBRequest<DiscussionDraft | undefined>;
    const keys = transaction.objectStore(CHUNKS).index('draftId').openKeyCursor(IDBKeyRange.only(id));
    let count = 0;
    let gap = false;
    const checked = new Promise<void>((resolve, reject) => {
      keys.onerror = () => reject(keys.error);
      keys.onsuccess = () => {
        const cursor = keys.result;
        if (!cursor) { resolve(); return; }
        const [, index] = cursor.primaryKey as [string, number];
        if (index !== count) gap = true;
        count += 1;
        cursor.continue();
      };
    });
    const [draft] = await Promise.all([requestResult(draftRequest), checked, done]);
    if (!draft) throw new Error('The recording draft is missing');
    if (gap || count !== draft.chunkCount) throw new Error('Local recording has missing chunks. Retained audio has not been deleted.');
    if (!count) throw new Error('No audio was saved before the recording stopped');
    let mediaCoverage = verifiedSavedThrough(draft) === null ? undefined : draft.mediaCoverage;
    let epochs = draft.epochs;
    if (draft.mediaCoverage?.status === 'gap' || (epochs?.length ?? 0) > 1) {
      const checkedEpochs = (epochs?.length ? epochs : [{ firstChunk: 0, mimeType: draft.mimeType, startedAt: draft.startedAt }]).map(epoch => ({ ...epoch }));
      for (let epoch = 0; epoch < checkedEpochs.length; epoch++) {
        const current = checkedEpochs[epoch];
        const end = checkedEpochs[epoch + 1]?.firstChunk ?? count;
        if (!Number.isInteger(current.firstChunk) || (epoch === 0 && current.firstChunk !== 0)
          || current.firstChunk < 0 || current.firstChunk > end || end > count) {
          throw new Error('Local recording has invalid audio boundaries. Retained audio has not been deleted.');
        }
        const reader = new RecordingMediaCoverageReader(current.mimeType);
        for (let index = current.firstChunk; index < end; index++) {
          const reading = db.transaction(CHUNKS, 'readonly');
          const committed = transactionDone(reading);
          const part = await requestResult(reading.objectStore(CHUNKS).get([id, index])) as DiscussionDraftChunk | undefined;
          await committed;
          if (!part) throw new Error('Local recording has missing chunks. Retained audio has not been deleted.');
          reader.append(new Uint8Array(await part.blob.arrayBuffer()));
        }
        if (epoch < checkedEpochs.length - 1) current.savedThroughMs = reader.snapshot().verifiedThroughMs;
        else mediaCoverage = { ...reader.snapshot(), committedChunkCount: count };
      }
      if (epochs?.length) epochs = checkedEpochs;
    }
    return { ...draft,
      epochs,
      mediaCoverage,
      saveOutcome: draft.state === 'recording' ? 'interrupted' : draft.saveOutcome,
    };
  } finally { db.close(); }
}
