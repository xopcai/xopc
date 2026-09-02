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
    return loadSecureStore()?.getItem(key, { keychainService: KEYCHAIN_SERVICE }) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    const store = loadSecureStore();
    if (store?.setItem) {
      store.setItem(key, value, { keychainService: KEYCHAIN_SERVICE });
      return;
    }
  } catch {
    // Tests and Expo Go use the in-memory fallback.
  }
  memory.set(key, value);
}

function remove(key: string): void {
  memory.delete(key);
  const store = loadSecureStore();
  if (store?.deleteItemAsync) void store.deleteItemAsync(key, { keychainService: KEYCHAIN_SERVICE });
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

/** @internal */
export function __clearDeviceCredentialMemoryForTests(): void {
  memory.clear();
}
