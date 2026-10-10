import type { BrowserRecording, BrowserRecordingEvent } from '@xopcai/browser-control-contract';

type Session = Omit<BrowserRecording, 'events'> & { count: number; ack: number; bytes: number };
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('xopc-browser-recordings', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.result.createObjectStore('events', { keyPath: ['recordingId', 'seq'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await open();
  const tx = db.transaction(['sessions', 'events'], mode);
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  try { const result = await work(tx); await done; return result; }
  catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
  finally { db.close(); }
}
export function recordings(): Promise<Session[]> { return transaction('readonly', async (tx) => { const rows: Session[] = await request(tx.objectStore('sessions').getAll()); return rows.sort((a, b) => a.createdAtMs - b.createdAtMs); }); }
export function saveRecording(session: Session): Promise<void> { return transaction('readwrite', async (tx) => { await request(tx.objectStore('sessions').put(session)); }); }
export function recordingEvents(id: string, after = 0): Promise<BrowserRecordingEvent[]> {
  return transaction('readonly', async (tx) => {
    const rows = await request(tx.objectStore('events').getAll(IDBKeyRange.bound([id, after + 1], [id, Number.MAX_SAFE_INTEGER]), 100));
    return rows.map(({ recordingId: _recordingId, ...event }) => event);
  });
}
export function appendRecordingEvent(id: string, generation: number, tabId: number, event: Omit<BrowserRecordingEvent, 'seq'>): Promise<void> {
  return transaction('readwrite', async (tx) => {
    const sessions = tx.objectStore('sessions');
    const session: Session = await request(sessions.get(id));
    if (!session || session.state !== 'recording' || session.generation !== generation || session.tabId !== tabId) throw new Error('Recording is no longer active.');
    if (session.count >= 10_000) throw new Error('Recording event limit reached. Finish this recording.');
    const bytes = session.bytes + new TextEncoder().encode(JSON.stringify(event)).length;
    if (bytes > 20 * 1024 * 1024) throw new Error('Recording storage limit reached.');
    const seq = session.count + 1;
    await request(tx.objectStore('events').add({ ...event, recordingId: id, seq }));
    await request(sessions.put({ ...session, count: seq, bytes }));
  });
}
export function deleteRecordingEvents(id: string, through: number): Promise<void> {
  return transaction('readwrite', async (tx) => { await request(tx.objectStore('events').delete(IDBKeyRange.bound([id, 1], [id, through]))); });
}

export function patchRecording(id: string, patch: Partial<Session>): Promise<void> {
  return transaction('readwrite', async (tx) => {
    const store = tx.objectStore('sessions');
    const current: Session = await request(store.get(id));
    if (!current) throw new Error('Recording not found.');
    await request(store.put({ ...current, ...patch }));
  });
}
