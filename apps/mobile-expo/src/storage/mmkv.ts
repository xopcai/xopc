import Constants, { ExecutionEnvironment } from 'expo-constants';

export const KEYS = {
  baseUrl: 'gateway.baseUrl',
  lanUrl: 'gateway.lanUrl',
  token: 'gateway.token',
  profiles: 'gateway.profiles',
  activeId: 'gateway.activeId',
  routeWinnerPrefix: 'gateway.routeWinner:',
  routeOverridePrefix: 'gateway.routeOverride:',
  queryCachePrefix: 'gateway.queryCache:',
  pendingRunPrefix: 'xopc:pendingRun:',
  language: 'prefs.language',
  themePreference: 'prefs.themePreference',
  clipboardIntakeEnabled: 'prefs.clipboardIntakeEnabled',
  clipboardHandledHashes: 'clipboard.handledHashes',
  clipboardLatestAppHash: 'clipboard.latestAppHash',
  defaultAgentId: 'prefs.defaultAgentId',
  selectedModelRef: 'prefs.selectedModelRef',
  noteTags: 'prefs.noteTags',
} as const;

export type KeyValueStorage = {
  getString(key: string): string | undefined;
  set(key: string, value: string | number | boolean): void;
  delete(key: string): void;
};

// ── Platform detection ──
// We avoid importing Platform from react-native at module top level because
// in some Expo Web bundler configurations the import resolves before RN-web
// is fully initialised. Instead we detect web via `document` existence which
// is reliable in all JS runtimes.

function isWeb(): boolean {
  return typeof document !== 'undefined';
}

// ── Web: localStorage (persists across page refresh) ──

function webGetString(key: string): string | undefined {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function webSet(key: string, value: string | number | boolean): void {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch { /* quota or private browsing */ }
}

function webDelete(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch { /* ignore */ }
}

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

// ── Public storage: delegates per-call to correct backend ──

export const storage: KeyValueStorage = {
  getString(key: string): string | undefined {
    if (isWeb()) return webGetString(key);
    const native = getNativeMmkv();
    if (native) return native.getString(key);
    return memory.get(key);
  },
  set(key: string, value: string | number | boolean): void {
    if (isWeb()) { webSet(key, value); return; }
    const native = getNativeMmkv();
    if (native) native.set(key, value);
    else memory.set(key, String(value));
  },
  delete(key: string): void {
    if (isWeb()) { webDelete(key); return; }
    const native = getNativeMmkv();
    if (native) native.remove(key);
    else memory.delete(key);
  },
};

export function pendingRunStorageKey(sessionKey: string): string {
  return `${KEYS.pendingRunPrefix}${sessionKey}`;
}
