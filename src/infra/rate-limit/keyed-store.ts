/**
 * Keyed in-memory store with periodic stale-entry sweep. Internal helper for
 * the rate-limit primitives — keep it package-private (re-export only via
 * `infra/rate-limit/index.ts` if a real consumer appears).
 *
 * Lifecycle: `new` → use → `destroy()`. Buckets created from this store are
 * registered in the gateway's bucket registry, which calls `destroy()` on
 * graceful shutdown so the cleanup timer doesn't leak.
 */

export type Clock = () => number;

export type KeyedStoreOptions = {
  /** Drop entries whose `lastTouchedMs` is older than this. */
  staleAfterMs: number;
  maxEntries?: number;
  /** How often the sweep runs. Defaults to `staleAfterMs / 4` (capped at 10min). */
  cleanupIntervalMs?: number;
  /** Injected clock for deterministic tests. */
  clock?: Clock;
};

export class KeyedStore<V extends { lastTouchedMs: number }> {
  private readonly map = new Map<string, V>();
  private readonly maxEntries: number;
  private overflow?: V;
  private readonly clock: Clock;
  private readonly staleAfterMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(opts: KeyedStoreOptions) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? 10_000);
    this.clock = opts.clock ?? Date.now;
    this.staleAfterMs = Math.max(1000, opts.staleAfterMs);
    const interval = Math.min(
      10 * 60 * 1000,
      Math.max(1000, opts.cleanupIntervalMs ?? Math.floor(this.staleAfterMs / 4)),
    );
    this.cleanupTimer = setInterval(() => this.sweep(), interval);
    this.cleanupTimer.unref?.();
  }

  get(key: string): V | undefined {
    return this.map.get(key) ?? (this.map.size >= this.maxEntries ? this.overflow : undefined);
  }

  set(key: string, value: V): void {
    if (this.map.has(key) || this.map.size < this.maxEntries) this.map.set(key, value);
    else this.overflow ??= value;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.overflow = undefined;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.map.clear();
    this.overflow = undefined;
  }

  private sweep(): void {
    const now = this.clock();
    if (this.overflow && now - this.overflow.lastTouchedMs > this.staleAfterMs) this.overflow = undefined;
    for (const [k, v] of this.map.entries()) {
      if (now - v.lastTouchedMs > this.staleAfterMs) {
        this.map.delete(k);
      }
    }
  }
}
