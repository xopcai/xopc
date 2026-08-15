import type { DiscussionDraft, DiscussionDraftChunk, DiscussionLiveSegment } from './discussion-types';

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
    request.onupgradeneeded = (event) => {
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
      if (event.oldVersion > 0 && event.oldVersion < DATABASE_VERSION) {
        request.transaction?.objectStore(DRAFTS).clear();
        request.transaction?.objectStore(CHUNKS).clear();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local recording storage'));
  });
}

export async function saveDiscussionDraft(draft: DiscussionDraft): Promise<void> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(DRAFTS, 'readwrite');
    transaction.objectStore(DRAFTS).put(draft);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function saveDiscussionDraftChunk(chunk: DiscussionDraftChunk): Promise<void> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(CHUNKS, 'readwrite');
    transaction.objectStore(CHUNKS).put(chunk);
    await transactionDone(transaction);
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

export async function listDiscussionDraftChunks(draftId: string): Promise<DiscussionDraftChunk[]> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction(CHUNKS, 'readonly');
    const done = transactionDone(transaction);
    const chunks = await requestResult(
      transaction.objectStore(CHUNKS).index('draftId').getAll(draftId),
    ) as DiscussionDraftChunk[];
    await done;
    return chunks.sort((a, b) => a.index - b.index);
  } finally {
    db.close();
  }
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
