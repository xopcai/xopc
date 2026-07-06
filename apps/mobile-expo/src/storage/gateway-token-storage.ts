type SecureStoreModule = typeof import('expo-secure-store');

const KEY_PREFIX = 'xopc.gateway.token.';
const KEYCHAIN_SERVICE = 'xopc.gateway.tokens';

const memoryTokens = new Map<string, string>();
let secureStore: SecureStoreModule | null | undefined;

function tokenKey(profileId: string): string {
  return `${KEY_PREFIX}${profileId.replace(/[^\w.-]/g, '_')}`;
}

function isWeb(): boolean {
  return typeof document !== 'undefined';
}

function loadSecureStore(): SecureStoreModule | null {
  if (secureStore !== undefined) return secureStore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer native module load for tests/web
    secureStore = require('expo-secure-store') as SecureStoreModule;
  } catch {
    secureStore = null;
  }
  return secureStore;
}

function webGet(key: string): string {
  try {
    return globalThis.localStorage?.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function webSet(key: string, value: string): void {
  try {
    if (value) globalThis.localStorage?.setItem(key, value);
    else globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readGatewayToken(profileId: string): string {
  if (!profileId) return '';
  const key = tokenKey(profileId);
  if (isWeb()) return webGet(key);
  const store = loadSecureStore();
  if (store?.getItem) {
    try {
      return store.getItem(key, { keychainService: KEYCHAIN_SERVICE }) ?? '';
    } catch {
      /* fallback below */
    }
  }
  return memoryTokens.get(key) ?? '';
}

export function writeGatewayToken(profileId: string, token: string): void {
  if (!profileId) return;
  const key = tokenKey(profileId);
  const value = token.trim();
  if (isWeb()) {
    webSet(key, value);
    return;
  }
  const store = loadSecureStore();
  if (store?.setItem && store?.deleteItemAsync) {
    try {
      if (value) store.setItem(key, value, { keychainService: KEYCHAIN_SERVICE });
      else void store.deleteItemAsync(key, { keychainService: KEYCHAIN_SERVICE });
      return;
    } catch {
      /* fallback below */
    }
  }
  if (value) memoryTokens.set(key, value);
  else memoryTokens.delete(key);
}

export function deleteGatewayToken(profileId: string): void {
  writeGatewayToken(profileId, '');
}

/** @internal */
export function __clearGatewayTokenMemoryForTests(): void {
  memoryTokens.clear();
}
