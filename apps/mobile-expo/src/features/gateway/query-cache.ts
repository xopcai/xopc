/**
 * Generic MMKV-backed cache for "stuff we just want to render the moment the
 * app cold-starts". Used as react-query `placeholderData` so the chat drawer
 * sessions, the chat-header agent name, and the active session's transcript
 * appear instantly while the live request fans out behind the scenes.
 *
 * Each entry is keyed by `(namespace, profileId, scope)`. Profile keying
 * means a multi-gateway user sees their own data; scope lets one namespace
 * (e.g. session-detail) keep one entry per session key.
 *
 * Validity: 1 hour by default. Past that we return null and the live request
 * gets a real loading state — better than rendering data the user might
 * mistake for current.
 */
import { KEYS, storage } from '../../storage/mmkv';

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

type Wrapped<T> = {
  recordedAt: number;
  data: T;
};

function buildKey(namespace: string, profileId: string, scope?: string): string {
  const ns = `${KEYS.queryCachePrefix}${namespace}:${profileId}`;
  return scope ? `${ns}:${scope}` : ns;
}

export type QueryCacheOptions = {
  /** Override TTL. Pass Infinity to disable expiry. */
  maxAgeMs?: number;
};

export function readQueryCache<T>(
  namespace: string,
  profileId: string | null | undefined,
  scope?: string,
  options: QueryCacheOptions = {},
): T | null {
  if (!profileId) return null;
  const raw = storage.getString(buildKey(namespace, profileId, scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Wrapped<T> | null;
    if (!parsed || typeof parsed.recordedAt !== 'number') return null;
    const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    if (Number.isFinite(maxAge) && Date.now() - parsed.recordedAt > maxAge) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writeQueryCache<T>(
  namespace: string,
  profileId: string | null | undefined,
  scope: string | undefined,
  data: T,
): void {
  if (!profileId) return;
  try {
    const payload: Wrapped<T> = { recordedAt: Date.now(), data };
    storage.set(buildKey(namespace, profileId, scope), JSON.stringify(payload));
  } catch {
    /* quota / serialization */
  }
}

export function clearQueryCache(
  namespace: string,
  profileId: string | null | undefined,
  scope?: string,
): void {
  if (!profileId) return;
  storage.delete(buildKey(namespace, profileId, scope));
}

/** Stable namespaces — defined here so the strings live in one place. */
export const QUERY_CACHE_NAMESPACES = {
  sessions: 'sessions',
  agents: 'agents',
  sessionDetail: 'sessionDetail',
} as const;
