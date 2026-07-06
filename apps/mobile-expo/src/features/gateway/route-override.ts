/**
 * Per-profile manual route override. Power users on flaky networks (split
 * DNS, weird Wi-Fi captive portals, hairpin NAT) can pin the app to LAN or
 * Cloud regardless of what the race says. Default is `auto` — the
 * Happy-Eyeballs race picks the winner.
 *
 * Stored in MMKV per profile so multi-gateway users get independent settings.
 * Read synchronously at probe time; written through a small pub/sub so the
 * UI updates instantly.
 */
import { KEYS, storage } from '../../storage/mmkv';

export type RouteOverride = 'auto' | 'lan' | 'tunnel';

const VALID: ReadonlySet<RouteOverride> = new Set<RouteOverride>(['auto', 'lan', 'tunnel']);

function key(profileId: string): string {
  return `${KEYS.routeOverridePrefix}${profileId}`;
}

const listeners = new Set<(profileId: string, override: RouteOverride) => void>();

export function readRouteOverride(profileId: string | null | undefined): RouteOverride {
  if (!profileId) return 'auto';
  const raw = storage.getString(key(profileId));
  if (!raw) return 'auto';
  return VALID.has(raw as RouteOverride) ? (raw as RouteOverride) : 'auto';
}

export function writeRouteOverride(profileId: string | null | undefined, override: RouteOverride): void {
  if (!profileId) return;
  if (override === 'auto') {
    storage.delete(key(profileId));
  } else {
    storage.set(key(profileId), override);
  }
  for (const cb of listeners) cb(profileId, override);
}

export function subscribeRouteOverride(
  cb: (profileId: string, override: RouteOverride) => void,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** @internal test helper */
export function __resetRouteOverrideListenersForTests(): void {
  listeners.clear();
}
