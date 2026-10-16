import type { DiscussionAnnotation } from '@xopcai/gateway-contract';

export interface LocalDiscussionAnnotation {
  recordingId: string;
  annotation: DiscussionAnnotation;
  nonce: string;
  state: 'pending' | 'synced' | 'conflict';
}
const changed = () => window.dispatchEvent(new Event('discussion-annotations-changed'));
async function database() {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open('xopc-note-annotations',1);
    request.onupgradeneeded = () => { const store = request.result.createObjectStore('annotations',{ keyPath: ['recordingId','annotation.id'] }); store.createIndex('recordingId','recordingId'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(write: boolean, work: (store: IDBObjectStore, done: (result: T) => void,fail: (error: Error) => void) => void): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve,reject) => {
      const tx = db.transaction('annotations',write ? 'readwrite' : 'readonly',{ durability: 'strict' }); let result: T; let failure: Error | undefined;
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(failure ?? tx.error ?? new Error('Annotation save failed')); tx.onerror = () => reject(tx.error);
      try { work(tx.objectStore('annotations'),value => { result = value; },error => { failure = error; tx.abort(); }); } catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}
export async function listLocalAnnotations(recordingId: string): Promise<LocalDiscussionAnnotation[]> {
  return transaction(false,(store,done) => { const request = store.index('recordingId').getAll(recordingId); request.onsuccess = () => done(request.result); });
}
export async function saveLocalAnnotation(recordingId: string, annotation: DiscussionAnnotation,expectedNonce?: string | null): Promise<void> {
  await transaction<void>(true,(store,done,fail) => {
    const request = store.get([recordingId,annotation.id]); request.onsuccess = () => {
      const current = request.result as LocalDiscussionAnnotation | undefined;
      if (expectedNonce !== undefined && (expectedNonce === null ? current && current.state !== 'synced' : current?.nonce !== expectedNonce)) { fail(new Error('Annotation changed in another tab. Your editor content is retained; reload before saving.')); return; }
      store.put({ recordingId,annotation,nonce: crypto.randomUUID(),state: 'pending' } satisfies LocalDiscussionAnnotation); done();
    };
  }); changed();
}

export function newAnnotation(anchor: DiscussionAnnotation['anchor'], kind: DiscussionAnnotation['kind'] = 'highlight'): DiscussionAnnotation {
  const now = Date.now(); return { id: crypto.randomUUID(), kind, text: '', anchor, revision: 0, deleted: false, createdAt: now, updatedAt: now };
}
export async function resolveLocalAnnotationAnchor(recordingId: string,id: string,offsetMs: number): Promise<void> {
  await transaction<void>(true,(store,done) => {
    const request = store.get([recordingId,id]); request.onsuccess = () => {
      const row = request.result as LocalDiscussionAnnotation | undefined;
      if (row && row.annotation.anchor.offsetMs === undefined) store.put({ ...row, nonce: crypto.randomUUID(), state: 'pending', annotation: { ...row.annotation, anchor: { ...row.annotation.anchor, offsetMs } } });
      done();
    };
  }); changed();
}
export async function acknowledgeLocalAnnotation(row: LocalDiscussionAnnotation, remote?: DiscussionAnnotation, conflict = false): Promise<void> {
  await transaction<void>(true,(store,done) => {
    const request = store.get([row.recordingId,row.annotation.id]); request.onsuccess = () => {
      const current = request.result as LocalDiscussionAnnotation | undefined;
      if (current) {
        if (current.nonce === row.nonce) store.put({ ...current, annotation: remote ?? current.annotation, state: conflict ? 'conflict' : 'synced' });
        else if (remote && current.annotation.revision === row.annotation.revision) store.put({ ...current, annotation: { ...current.annotation, revision: remote.revision } });
      }
      done();
    };
  }); changed();
}
