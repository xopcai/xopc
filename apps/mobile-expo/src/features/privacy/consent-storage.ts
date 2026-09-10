import { storage, type KeyValueStorage } from '../../storage/mmkv';

type DurableConsentStore = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
};

type SecureStoreModule = typeof import('expo-secure-store');

const KEYCHAIN_SERVICE = 'xopc.privacy-consent';
const SECURE_KEY_PREFIX = 'xopc.privacy.consent.';
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

function secureKey(key: string): string {
  return `${SECURE_KEY_PREFIX}${key.replace(/[^\w.-]/g, (character) => (
    `_${character.charCodeAt(0).toString(16)}_`
  ))}`;
}

const nativeConsentStore: DurableConsentStore = {
  getString(key) {
    try {
      return loadSecureStore()?.getItem(secureKey(key), { keychainService: KEYCHAIN_SERVICE }) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(key, value) {
    try {
      loadSecureStore()?.setItem(secureKey(key), value, { keychainService: KEYCHAIN_SERVICE });
    } catch {
      // Keep the MMKV/cache write usable when SecureStore is unavailable.
    }
  },
};

/** MMKV is the fast cache; SecureStore preserves consent through Expo Go process restarts. */
export function createConsentDecisionStorage(
  cache: KeyValueStorage,
  durable: DurableConsentStore,
): Pick<KeyValueStorage, 'getString' | 'set'> {
  return {
    getString(key) {
      const cached = cache.getString(key);
      if (cached !== undefined) return cached;
      const persisted = durable.getString(key);
      if (persisted !== undefined) cache.set(key, persisted);
      return persisted;
    },
    set(key, value) {
      const normalized = String(value);
      cache.set(key, normalized);
      durable.set(key, normalized);
    },
  };
}

export const consentDecisionStorage = createConsentDecisionStorage(
  storage,
  nativeConsentStore,
);
