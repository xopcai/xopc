type SecureStoreModule = typeof import('expo-secure-store');

const KEY_PREFIX = 'xopc.gateway.token.';
const KEYCHAIN_SERVICE = 'xopc.gateway.tokens';

const memoryTokens = new Map<string, string>();
let secureStore: SecureStoreModule | null | undefined;

function tokenKey(profileId: string): string {
  return `${KEY_PREFIX}${profileId.replace(/[^\w.-]/g, '_')}`;
}

function loadSecureStore(): SecureStoreModule | null {
  if (secureStore !== undefined) return secureStore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer native module load for tests
    secureStore = require('expo-secure-store') as SecureStoreModule;
  } catch {
    secureStore = null;
  }
  return secureStore;
}

export function readGatewayToken(profileId: string): string {
  if (!profileId) return '';
  const key = tokenKey(profileId);
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
