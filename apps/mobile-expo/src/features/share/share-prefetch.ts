/**
 * Tiny in-process cache for *pre-resolved* share creation promises.
 *
 * The flow this enables:
 *  1. The user opens a chat-artifact preview / hovers on a card. The caller
 *     fires `prefetchShare(request)` — this kicks `createAutoShare()` in the
 *     background and stashes the in-flight (or resolved) Promise.
 *  2. The user later taps "Share" on that same artifact. `ShareSheet` calls
 *     `consumePrefetchedShare(request)` — if there's a hit, the sheet
 *     resolves instantly without firing a second request.
 *
 * Why not React-Query?
 *  - `createAutoShare` is semantically a *mutation* with server-side cost
 *    (writes a record, allocates a token). Modelling it as a `useQuery` would
 *    invite retries / refetches that double-spend that cost.
 *  - We need a key derived from the request body, not a static query key.
 *  - The window of usefulness is small (≤ 5 min); we don't want long-lived
 *    React-Query cache entries living past that.
 *
 * The cache is best-effort: a cache miss simply falls back to firing the
 * mutation in `ShareSheet` as before. Never throws.
 */
import { createAutoShare, type ShareAutoPayload, type ShareAutoRequest } from '../../api/share';

const TTL_MS = 5 * 60_000;

type Entry = {
  promise: Promise<ShareAutoPayload>;
  expiresAt: number;
};

const cache = new Map<string, Entry>();

function keyOf(req: ShareAutoRequest): string {
  // JSON.stringify is order-sensitive, but the caller is the same one that
  // later calls consume — they'll produce the same key shape. If a future
  // caller needs canonical ordering, switch to a sorted-keys serializer.
  return JSON.stringify(req);
}

function dropExpired(now: number): void {
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

/**
 * Fire share creation in the background and cache the promise. Idempotent: a
 * second call with the same request returns without re-firing.
 *
 * The promise's rejection is swallowed by the cache itself so an unattached
 * prefetch never leaves an unhandled-rejection warning. Callers that *do*
 * consume the promise will still see the rejection.
 */
export function prefetchShare(req: ShareAutoRequest): void {
  const now = Date.now();
  dropExpired(now);
  const key = keyOf(req);
  if (cache.has(key)) return;
  const promise = createAutoShare(req);
  // Detach a sink so the unawaited prefetch doesn't generate a warning.
  promise.catch(() => {});
  cache.set(key, { promise, expiresAt: now + TTL_MS });
}

/**
 * Return the prefetched promise for this exact request, removing it from the
 * cache. Returns `null` if there is no matching entry — the caller should
 * trigger the share creation itself.
 */
export function consumePrefetchedShare(req: ShareAutoRequest): Promise<ShareAutoPayload> | null {
  const now = Date.now();
  dropExpired(now);
  const key = keyOf(req);
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  return entry.promise;
}

/** Test-only: wipe the cache between cases. */
export function resetShareprefetchCacheForTests(): void {
  cache.clear();
}
