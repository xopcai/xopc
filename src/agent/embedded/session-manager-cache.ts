import fs from 'node:fs/promises';

const DEFAULT_TTL_MS = 30_000;

/**
 * Tracks which session JSONL files we have already confirmed exist on disk so
 * subsequent acquires can skip the open/close probe. The class is owned by the
 * session runner pool; {@link defaultSessionManagerCache} keeps the free-function
 * API working until every caller has been wired through dependency injection.
 */
export class SessionManagerCache {
  private readonly seen = new Map<string, boolean>();

  async prewarm(sessionFile: string): Promise<void> {
    if (this.seen.get(sessionFile) === true) {
      return;
    }
    try {
      const handle = await fs.open(sessionFile, 'r');
      await handle.close();
      this.seen.set(sessionFile, true);
    } catch {
      // File doesn't exist yet; SessionManager will create it
    }
  }

  trackAccess(sessionFile: string): void {
    this.seen.set(sessionFile, true);
  }

  has(sessionFile: string): boolean {
    return this.seen.get(sessionFile) === true;
  }

  resetForTest(): void {
    this.seen.clear();
  }
}

export const defaultSessionManagerCache = new SessionManagerCache();

export function prewarmSessionFile(sessionFile: string): Promise<void> {
  return defaultSessionManagerCache.prewarm(sessionFile);
}

export function trackSessionManagerAccess(sessionFile: string): void {
  defaultSessionManagerCache.trackAccess(sessionFile);
}

export function isSessionManagerCached(sessionFile: string): boolean {
  return defaultSessionManagerCache.has(sessionFile);
}

export function resetSessionManagerCacheForTest(): void {
  defaultSessionManagerCache.resetForTest();
}

export function getSessionManagerCacheTtlMs(): number {
  return DEFAULT_TTL_MS;
}
