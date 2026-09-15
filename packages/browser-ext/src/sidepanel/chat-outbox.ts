import { t } from '../i18n';

import { openDatabase } from './chat-state';

const OUTBOX_STORE = 'outbox';

function transactionResult<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OUTBOX_STORE, mode);
    const request = createRequest(transaction.objectStore(OUTBOX_STORE));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error(t('errorOutboxRequest')));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error(t('errorOutboxTransaction')));
    transaction.onabort = () => reject(transaction.error ?? new Error(t('errorOutboxAborted')));
  });
}

export async function readBrowserOutbox<T>(sessionKey: string): Promise<T | undefined> {
  const database = await openDatabase();
  try {
    return await transactionResult<T | undefined>(
      database,
      'readonly',
      (store) => store.get(sessionKey),
    );
  } finally {
    database.close();
  }
}

export async function writeBrowserOutbox<T>(sessionKey: string, value: T): Promise<void> {
  const database = await openDatabase();
  try {
    await transactionResult(database, 'readwrite', (store) => store.put(value, sessionKey));
  } finally {
    database.close();
  }
}

export async function deleteBrowserOutbox(sessionKey: string): Promise<void> {
  const database = await openDatabase();
  try {
    await transactionResult(database, 'readwrite', (store) => store.delete(sessionKey));
  } finally {
    database.close();
  }
}
