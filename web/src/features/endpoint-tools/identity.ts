const DATABASE_NAME = 'xopc-endpoint-tools';
const STORE_NAME = 'identity';
const ENDPOINT_ID_KEY = 'xopc.endpoint-tools.endpoint-id';

export interface EndpointIdentity {
  principalId: string;
  publicKey: string;
  privateKey: CryptoKey;
}

let memoryEndpointId: string | undefined;

export function getEndpointId(principalId: string): string {
  if (memoryEndpointId?.startsWith(`${principalId}:`)) return memoryEndpointId;
  const stored = sessionStorage.getItem(ENDPOINT_ID_KEY);
  if (stored?.startsWith(`${principalId}:`)) {
    memoryEndpointId = stored;
    return stored;
  }
  memoryEndpointId = `${principalId}:${crypto.randomUUID()}`;
  sessionStorage.setItem(ENDPOINT_ID_KEY, memoryEndpointId);
  return memoryEndpointId;
}

function base64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function openIdentityDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Endpoint identity database failed'));
  });
}

async function readIdentity(kind: 'web' | 'desktop'): Promise<EndpointIdentity | undefined> {
  const database = await openIdentityDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(kind);
      request.onsuccess = () => resolve(request.result as EndpointIdentity | undefined);
      request.onerror = () => reject(request.error ?? new Error('Endpoint identity read failed'));
    });
  } finally {
    database.close();
  }
}

async function writeIdentity(kind: 'web' | 'desktop', identity: EndpointIdentity): Promise<void> {
  const database = await openIdentityDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(identity, kind);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Endpoint identity write failed'));
    });
  } finally {
    database.close();
  }
}

async function deleteIdentity(kind: 'web' | 'desktop'): Promise<void> {
  const database = await openIdentityDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(kind);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Endpoint identity deletion failed'));
    });
  } finally {
    database.close();
  }
}

export async function getOrCreateEndpointIdentity(
  kind: 'web' | 'desktop',
): Promise<EndpointIdentity> {
  const existing = await readIdentity(kind);
  if (existing) return existing;

  const generated = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicKey = base64Url(await crypto.subtle.exportKey('spki', generated.publicKey));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    await crypto.subtle.exportKey('pkcs8', generated.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const identity = { principalId: crypto.randomUUID(), publicKey, privateKey };
  await writeIdentity(kind, identity);
  return identity;
}

export async function rotateEndpointIdentity(
  kind: 'web' | 'desktop',
): Promise<EndpointIdentity> {
  await deleteIdentity(kind);
  memoryEndpointId = undefined;
  sessionStorage.removeItem(ENDPOINT_ID_KEY);
  return getOrCreateEndpointIdentity(kind);
}

export async function signEndpointPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(payload),
  );
  return base64Url(signature);
}
