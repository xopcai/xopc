import fs from 'node:fs/promises';

const DEFAULT_TTL_MS = 30_000;

const cache = new Map<string, boolean>();

export async function prewarmSessionFile(sessionFile: string): Promise<void> {
  if (cache.get(sessionFile) === true) {
    return;
  }
  try {
    const handle = await fs.open(sessionFile, 'r');
    await handle.close();
    cache.set(sessionFile, true);
  } catch {
    // File doesn't exist yet; SessionManager will create it
  }
}

export function trackSessionManagerAccess(sessionFile: string): void {
  cache.set(sessionFile, true);
}

export function isSessionManagerCached(sessionFile: string): boolean {
  return cache.get(sessionFile) === true;
}

export function resetSessionManagerCacheForTest(): void {
  cache.clear();
}

export function getSessionManagerCacheTtlMs(): number {
  return DEFAULT_TTL_MS;
}
