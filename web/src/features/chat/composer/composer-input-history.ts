const MAX_RECENT = 20;
const MAX_SESSIONS = 200;
const STORAGE_KEY = 'xopc.composer.inputHistory.v2';
const LEGACY_STORAGE_PREFIX = 'xopc.composer.inputHistory:';

type ComposerInputHistorySession = {
  updatedAt: number;
  items: string[];
};

type ComposerInputHistoryStore = {
  version: 2;
  sessions: Record<string, ComposerInputHistorySession>;
};

function getStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function emptyStore(): ComposerInputHistoryStore {
  return { version: 2, sessions: {} };
}

function sanitizeItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, MAX_RECENT);
}

function parseStore(raw: string | null): ComposerInputHistoryStore {
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyStore();
    const sessionsValue = (parsed as { sessions?: unknown }).sessions;
    if (!sessionsValue || typeof sessionsValue !== 'object' || Array.isArray(sessionsValue)) {
      return emptyStore();
    }
    const sessions: Record<string, ComposerInputHistorySession> = {};
    for (const [key, value] of Object.entries(sessionsValue)) {
      const sessionKey = key.trim();
      if (!sessionKey || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const items = sanitizeItems((value as { items?: unknown }).items);
      if (items.length === 0) continue;
      const rawUpdatedAt = (value as { updatedAt?: unknown }).updatedAt;
      sessions[sessionKey] = {
        updatedAt: typeof rawUpdatedAt === 'number' && Number.isFinite(rawUpdatedAt) ? rawUpdatedAt : 0,
        items,
      };
    }
    return { version: 2, sessions };
  } catch {
    return emptyStore();
  }
}

function loadStore(storage: Storage): { store: ComposerInputHistoryStore; legacyKeys: string[] } {
  const store = parseStore(storage.getItem(STORAGE_KEY));
  const legacyKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(LEGACY_STORAGE_PREFIX)) continue;
    const sessionKey = key.slice(LEGACY_STORAGE_PREFIX.length).trim();
    if (!sessionKey) continue;
    legacyKeys.push(key);
    try {
      const items = sanitizeItems(JSON.parse(storage.getItem(key) ?? 'null'));
      if (items.length === 0 || store.sessions[sessionKey]) continue;
      store.sessions[sessionKey] = {
        updatedAt: 0,
        items,
      };
    } catch {
      /* ignore corrupt legacy entries */
    }
  }
  return { store, legacyKeys };
}

function prunedStore(store: ComposerInputHistoryStore): ComposerInputHistoryStore {
  const entries: Array<[string, ComposerInputHistorySession]> = [];
  for (const [key, session] of Object.entries(store.sessions)) {
    const items = sanitizeItems(session.items);
    if (items.length === 0) continue;
    entries.push([
      key,
      {
        updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : 0,
        items,
      },
    ]);
  }
  const sessions = Object.fromEntries(
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_SESSIONS),
  );
  return { version: 2, sessions };
}

function nextUpdatedAt(store: ComposerInputHistoryStore): number {
  const latest = Math.max(0, ...Object.values(store.sessions).map((session) => session.updatedAt));
  return Math.max(Date.now(), latest + 1);
}

function saveStore(storage: Storage, store: ComposerInputHistoryStore, legacyKeys: string[] = []): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(prunedStore(store)));
  for (const key of legacyKeys) {
    storage.removeItem(key);
  }
}

export function getComposerInputHistory(sessionKey: string | null | undefined): string[] {
  const sk = sessionKey?.trim();
  const storage = getStorage();
  if (!sk || !storage) return [];
  try {
    const { store, legacyKeys } = loadStore(storage);
    if (legacyKeys.length > 0) {
      saveStore(storage, store, legacyKeys);
    }
    return store.sessions[sk]?.items.slice(0, MAX_RECENT) ?? [];
  } catch {
    return [];
  }
}

/** Persist latest user-submitted composer text for this session (max 20, dedupe head). */
export function recordComposerInputHistory(sessionKey: string | null | undefined, text: string): void {
  const sk = sessionKey?.trim();
  const t = text.trim();
  const storage = getStorage();
  if (!sk || !t || !storage) return;
  try {
    const { store, legacyKeys } = loadStore(storage);
    const prev = store.sessions[sk]?.items ?? [];
    const now = nextUpdatedAt(store);
    const next = [t, ...prev].slice(0, MAX_RECENT);
    store.sessions[sk] = {
      updatedAt: now,
      items: prev[0] === t ? prev : next,
    };
    saveStore(storage, store, legacyKeys);
  } catch {
    /* ignore quota */
  }
}

export const COMPOSER_INPUT_HISTORY_MAX = MAX_RECENT;
export const COMPOSER_INPUT_HISTORY_STORAGE_KEY = STORAGE_KEY;
export const COMPOSER_INPUT_HISTORY_MAX_SESSIONS = MAX_SESSIONS;
