import {
  decodeBase64Url,
  encodeBase64Url,
  generateDevicePrivateKey,
} from '../features/gateway/device-crypto';

type SecureStoreModule = typeof import('expo-secure-store');
const PRIVATE_KEY = 'xopc.device.private-key';
const REFRESH_PREFIX = 'xopc.device.refresh.';
const KEYCHAIN_SERVICE = 'xopc.device-auth';
const memory = new Map<string, string>();
let secureStore: SecureStoreModule | null | undefined;

function loadSecureStore(): SecureStoreModule | null {
  if (secureStore !== undefined) return secureStore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module is unavailable in unit tests
    secureStore = require('expo-secure-store') as SecureStoreModule;
  } catch {
    secureStore = null;
  }
  return secureStore;
}

function read(key: string): string | null {
  try {
    const store = loadSecureStore();
    if (!store && process.env.NODE_ENV !== 'test') throw new Error('Secure storage unavailable');
    return store?.getItem(key, { keychainService: KEYCHAIN_SERVICE }) || memory.get(key) || null;
  } catch {
    if (process.env.NODE_ENV === 'test') return memory.get(key) ?? null;
    throw new Error('Secure storage unavailable');
  }
}

function write(key: string, value: string): void {
  try {
    const store = loadSecureStore();
    if (store?.setItem) {
      store.setItem(key, value, { keychainService: KEYCHAIN_SERVICE });
      return;
    }
  } catch { if (process.env.NODE_ENV !== 'test') throw new Error('Secure storage unavailable'); }
  if (process.env.NODE_ENV !== 'test') throw new Error('Secure storage unavailable');
  memory.set(key, value);
}

function remove(key: string): void {
  memory.delete(key);
  // Synchronous tombstone avoids deleting a newer credential after an async removal.
  const store = loadSecureStore();
  if (store?.setItem) store.setItem(key, '', { keychainService: KEYCHAIN_SERVICE });
}

export function getOrCreateDevicePrivateKey(): Uint8Array {
  const stored = read(PRIVATE_KEY);
  if (stored) return decodeBase64Url(stored);
  const privateKey = generateDevicePrivateKey();
  write(PRIVATE_KEY, encodeBase64Url(privateKey));
  return privateKey;
}

function refreshKey(gatewayId: string): string {
  return `${REFRESH_PREFIX}${gatewayId.replace(/[^\w.-]/g, '_')}`;
}

export function readDeviceRefreshToken(gatewayId: string): string | null {
  return read(refreshKey(gatewayId));
}

export function writeDeviceRefreshToken(gatewayId: string, token: string): void {
  write(refreshKey(gatewayId), token);
}

export function deleteDeviceRefreshToken(gatewayId: string): void {
  remove(refreshKey(gatewayId));
}

export function readDeviceAuthJournal<T>(id: string): T | null {
  const raw = read(`xopc.device.journal.${id.replace(/[^\w.-]/g, '_')}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function writeDeviceAuthJournal(id: string, value: unknown): void {
  write(`xopc.device.journal.${id.replace(/[^\w.-]/g, '_')}`, JSON.stringify(value));
}

export function clearDeviceAuthJournal(id: string): void {
  remove(`xopc.device.journal.${id.replace(/[^\w.-]/g, '_')}`);
}

/** @internal */
export function __clearDeviceCredentialMemoryForTests(): void {
  memory.clear();
}
