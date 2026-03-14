/**
 * Runtime Cache
 * 
 * Caches active runtime handles for ACP sessions.
 */

import type { AcpRuntime, AcpRuntimeHandle, AcpRuntimeSessionMode } from "../runtime/types.js";

/** Cached Runtime State */
export type CachedRuntimeState = {
  runtime: AcpRuntime;
  handle: AcpRuntimeHandle;
  backend: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  cwd?: string;
  appliedControlSignature?: string;
  lastTouchedAt: number;
};

export class RuntimeCache {
  private readonly cache = new Map<string, CachedRuntimeState>();
  private readonly lastTouchedAt = new Map<string, number>();

  /** Get cached runtime state */
  get(actorKey: string): CachedRuntimeState | null {
    return this.cache.get(actorKey) ?? null;
  }

  /** Set cached runtime state */
  set(actorKey: string, state: Omit<CachedRuntimeState, "lastTouchedAt">): void {
    const now = Date.now();
    this.cache.set(actorKey, {
      ...state,
      lastTouchedAt: now,
    });
    this.lastTouchedAt.set(actorKey, now);
  }

  /** Check if cache has entry */
  has(actorKey: string): boolean {
    return this.cache.has(actorKey);
  }

  /** Clear cache entry */
  clear(actorKey: string): void {
    this.cache.delete(actorKey);
    this.lastTouchedAt.delete(actorKey);
  }

  /** Get cache size */
  size(): number {
    return this.cache.size;
  }

  /** Peek at cache entry without updating touch time */
  peek(actorKey: string): CachedRuntimeState | null {
    return this.cache.get(actorKey) ?? null;
  }

  /** Get last touched time */
  getLastTouchedAt(actorKey: string): number | undefined {
    return this.lastTouchedAt.get(actorKey);
  }

  /** Collect idle candidates for eviction */
  collectIdleCandidates(params: {
    maxIdleMs: number;
    now: number;
  }): Array<{ actorKey: string; state: CachedRuntimeState }> {
    const { maxIdleMs, now } = params;
    const candidates: Array<{ actorKey: string; state: CachedRuntimeState }> = [];
    
    for (const [actorKey, state] of this.cache) {
      const lastTouched = this.lastTouchedAt.get(actorKey) ?? state.lastTouchedAt;
      if (now - lastTouched >= maxIdleMs) {
        candidates.push({ actorKey, state });
      }
    }
    
    return candidates;
  }

  /** Clear all entries */
  clearAll(): void {
    this.cache.clear();
    this.lastTouchedAt.clear();
  }
}