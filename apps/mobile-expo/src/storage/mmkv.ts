import Constants, { ExecutionEnvironment } from 'expo-constants';

export const KEYS = {
  profiles: 'gateway.profiles',
  activeId: 'gateway.activeId',
  queryCachePrefix: 'gateway.queryCache:',
  pendingRunPrefix: 'xopc:pendingRun:',
  language: 'prefs.language',
  themePreference: 'prefs.themePreference',
  clipboardIntakeEnabled: 'prefs.clipboardIntakeEnabled',
  clipboardHandledHashes: 'clipboard.handledHashes',
  clipboardLatestAppHash: 'clipboard.latestAppHash',
  defaultAgentId: 'prefs.defaultAgentId',
  newSessionPreferencesByGateway: 'prefs.newSessionPreferencesByGateway',
  endpointId: 'endpointTools.endpointId',
  notificationsEnabled: 'prefs.notificationsEnabled',
  autoReadAloudEnabled: 'prefs.autoReadAloudEnabled',
  noteTags: 'prefs.noteTags',
  usageEvents: 'product.usageEvents',
  homePinnedFocusId: 'home.pinnedFocusId',
  readAloudConsent: 'voice.readAloudConsent',
} as const;

export type KeyValueStorage = {
  getString(key: string): string | undefined;
  set(key: string, value: string | number | boolean): void;
  delete(key: string): void;
};

// ── Native: MMKV ──

type MMKVInstance = import('react-native-mmkv').MMKV;
let mmkv: MMKVInstance | null = null;
let nativeUnavailable = false;

function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

function getNativeMmkv(): MMKVInstance | null {
  if (mmkv) return mmkv;
  if (nativeUnavailable) return null;
  if (isExpoGo()) {
    nativeUnavailable = true;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional deferred native load
    const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    mmkv = createMMKV({ id: 'xopc-mobile' });
    return mmkv;
  } catch {
    nativeUnavailable = true;
    return null;
  }
}

// ── In-memory fallback (Expo Go without native MMKV) ──

const memory = new Map<string, string>();

// ── Public storage: MMKV with an Expo Go in-memory fallback ──

export const storage: KeyValueStorage = {
  getString(key: string): string | undefined {
    const native = getNativeMmkv();
    if (native) return native.getString(key);
    return memory.get(key);
  },
  set(key: string, value: string | number | boolean): void {
    const native = getNativeMmkv();
    if (native) native.set(key, value);
    else memory.set(key, String(value));
  },
  delete(key: string): void {
    const native = getNativeMmkv();
    if (native) native.remove(key);
    else memory.delete(key);
  },
};

export function pendingRunStorageKey(sessionKey: string): string {
  return `${KEYS.pendingRunPrefix}${sessionKey}`;
}
