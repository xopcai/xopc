import { createMMKV, type MMKV } from 'react-native-mmkv';

export const KEYS = {
  baseUrl: 'gateway.baseUrl',
  token: 'gateway.token',
  thinking: 'gateway.thinking',
  pendingRunPrefix: 'xopc:pendingRun:',
  language: 'prefs.language',
  themePreference: 'prefs.themePreference',
} as const;

export type KeyValueStorage = {
  getString(key: string): string | undefined;
  set(key: string, value: string | number | boolean): void;
  delete(key: string): void;
};

let mmkv: MMKV | null = null;
const memory = new Map<string, string>();

function getNativeMmkv(): MMKV | null {
  if (mmkv) return mmkv;
  try {
    mmkv = createMMKV({ id: 'xopc-mobile' });
    return mmkv;
  } catch {
    return null;
  }
}

export const storage: KeyValueStorage = {
  getString(key: string) {
    const native = getNativeMmkv();
    if (native) return native.getString(key);
    return memory.get(key);
  },
  set(key: string, value: string | number | boolean) {
    const native = getNativeMmkv();
    if (native) native.set(key, value);
    else memory.set(key, String(value));
  },
  delete(key: string) {
    const native = getNativeMmkv();
    if (native) native.remove(key);
    else memory.delete(key);
  },
};

export function pendingRunStorageKey(chatId: string): string {
  return `${KEYS.pendingRunPrefix}${chatId}`;
}
