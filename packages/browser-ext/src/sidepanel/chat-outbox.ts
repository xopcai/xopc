const DATABASE_NAME = 'xopc-browser-chat-state';
const DATABASE_VERSION = 1;
const OUTBOX_STORE = 'outbox';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OUTBOX_STORE)) {
        request.result.createObjectStore(OUTBOX_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the browser chat outbox'));
  });
}

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
    request.onerror = () => reject(request.error ?? new Error('Browser chat outbox request failed'));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser chat outbox transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser chat outbox transaction was aborted'));
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

export async function clearBrowserOutboxes(): Promise<void> {
  const database = await openDatabase();
  try {
    await transactionResult(database, 'readwrite', (store) => store.clear());
  } finally {
    database.close();
  }
}
