import type { DiscussionDraft, DiscussionDraftChunk } from './discussion-types';

const DATABASE_NAME = 'xopc-discussion-drafts';
const DATABASE_VERSION = 1;
const DRAFTS = 'drafts';
const CHUNKS = 'chunks';

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

export async function deleteDiscussionDraft(draftId: string): Promise<void> {
  const db = await openDraftDatabase();
  try {
    const transaction = db.transaction([DRAFTS, CHUNKS], 'readwrite');
    transaction.objectStore(DRAFTS).delete(draftId);
    const chunkStore = transaction.objectStore(CHUNKS);
    const cursorRequest = chunkStore.index('draftId').openKeyCursor(IDBKeyRange.only(draftId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      chunkStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}
