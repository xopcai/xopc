import { t } from '../i18n';

const DATABASE_NAME = 'xopc-browser-chat-state';
const DATABASE_VERSION = 2;

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
      if (!request.result.objectStoreNames.contains('outbox')) {
        request.result.createObjectStore('outbox');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(t('errorOpenOutbox')));
  });
}

export async function clearBrowserChatState(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['outbox', 'drafts'], 'readwrite');
      tx.objectStore('outbox').clear();
      tx.objectStore('drafts').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
