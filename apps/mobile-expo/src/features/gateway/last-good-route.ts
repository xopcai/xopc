/**
 * Per-(profile, network) cache of the last route that successfully answered
 * /health, plus a global "any-network" fallback for hydrate time when we
 * don't know the current network synchronously.
 *
 * Used at hydrate time to pre-set `activeBaseUrl` to the most likely winner
 * before any probe completes — eliminating the cold-start window where every
 * API call hits a dead address.
 *
 * Cache expires after MAX_AGE_MS so a stale entry can't lock us into a dead
 * route forever.
 */
import { KEYS, storage } from '../../storage/mmkv';

export type RouteKind = 'lan' | 'tunnel';

export type LastGoodRouteEntry = {
  url: string;
  kind: RouteKind;
  recordedAt: number;
  latencyMs?: number;
  networkKey?: string;
};

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ANY_NETWORK = '__any';

function cacheKey(profileId: string, networkKey: string): string {
  return `${KEYS.routeWinnerPrefix}${profileId}:${networkKey}`;
}

function readEntry(profileId: string, networkKey: string): LastGoodRouteEntry | null {
  if (!profileId) return null;
  const raw = storage.getString(cacheKey(profileId, networkKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastGoodRouteEntry> | null;
    if (!parsed || typeof parsed.url !== 'string' || !parsed.url.trim()) return null;
    if (parsed.kind !== 'lan' && parsed.kind !== 'tunnel') return null;
    const recordedAt = typeof parsed.recordedAt === 'number' ? parsed.recordedAt : 0;
    if (!recordedAt || nowMs() - recordedAt > MAX_AGE_MS) return null;
    return {
      url: parsed.url,
      kind: parsed.kind,
      recordedAt,
      latencyMs: typeof parsed.latencyMs === 'number' ? parsed.latencyMs : undefined,
      networkKey: typeof parsed.networkKey === 'string' ? parsed.networkKey : undefined,
    };
  } catch {
    return null;
  }
}

/** Look up the cached winner for the given network. */
export function readLastGoodRoute(
  profileId: string,
  networkKey: string,
): LastGoodRouteEntry | null {
  if (!profileId || !networkKey) return null;
  return readEntry(profileId, networkKey);
}

/** Hydrate-time fallback: latest winner across any network this profile saw. */
export function readAnyNetworkLastGoodRoute(profileId: string): LastGoodRouteEntry | null {
  if (!profileId) return null;
  return readEntry(profileId, ANY_NETWORK);
}

export function writeLastGoodRoute(
  profileId: string,
  networkKey: string,
  entry: Omit<LastGoodRouteEntry, 'recordedAt' | 'networkKey'>,
): void {
  if (!profileId || !networkKey) return;
  const recordedAt = nowMs();
  const payload: LastGoodRouteEntry = { ...entry, recordedAt, networkKey };
  storage.set(cacheKey(profileId, networkKey), JSON.stringify(payload));
  storage.set(cacheKey(profileId, ANY_NETWORK), JSON.stringify(payload));
}

export function clearLastGoodRoute(profileId: string, networkKey?: string): void {
  if (!profileId) return;
  if (networkKey) {
    storage.delete(cacheKey(profileId, networkKey));
    return;
  }
  storage.delete(cacheKey(profileId, ANY_NETWORK));
}

function nowMs(): number {
  return Date.now();
}

/** @internal */
export const __INTERNAL = { MAX_AGE_MS, ANY_NETWORK };
