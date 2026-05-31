import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { readSessionsJsonFileRaw } from './sessions-json-file-read.js';

type ReadCacheEntry = {
  mtimeMs: number;
  sizeBytes: number;
  parsed: Record<string, unknown>;
  serialized: string;
};

const readCache = new Map<string, ReadCacheEntry>();
const serializedWriteCache = new Map<string, string>();

let writeStats = {
  performed: 0,
  skippedUnchanged: 0,
};

export function getSessionsJsonWriteStats(): Readonly<typeof writeStats> {
  return writeStats;
}

export function resetSessionsJsonCacheForTest(): void {
  readCache.clear();
  serializedWriteCache.clear();
  writeStats = { performed: 0, skippedUnchanged: 0 };
}

export function invalidateSessionsJsonCache(storePath: string): void {
  readCache.delete(storePath);
  serializedWriteCache.delete(storePath);
}

function serializeSessionsJson(store: Record<string, unknown>): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

export async function readSessionsJsonCached(
  storePath: string,
): Promise<{ store: Record<string, unknown>; serialized: string }> {
  if (!existsSync(storePath)) {
    return { store: {}, serialized: '{}\n' };
  }

  let mtimeMs = 0;
  let sizeBytes = 0;
  try {
    const st = await stat(storePath);
    mtimeMs = st.mtimeMs;
    sizeBytes = st.size;
  } catch {
    return { store: {}, serialized: '{}\n' };
  }

  const cached = readCache.get(storePath);
  if (cached && cached.mtimeMs === mtimeMs && cached.sizeBytes === sizeBytes) {
    return { store: structuredClone(cached.parsed), serialized: cached.serialized };
  }

  const store = await readSessionsJsonFileRaw(storePath);
  const serialized = serializeSessionsJson(store);
  readCache.set(storePath, { mtimeMs, sizeBytes, parsed: structuredClone(store), serialized });
  serializedWriteCache.set(storePath, serialized);
  return { store: structuredClone(store), serialized };
}

export function commitSessionsJsonWrite(
  storePath: string,
  store: Record<string, unknown>,
  serialized: string,
): boolean {
  const previous = serializedWriteCache.get(storePath);
  if (previous === serialized) {
    writeStats.skippedUnchanged += 1;
    readCache.set(storePath, {
      mtimeMs: readCache.get(storePath)?.mtimeMs ?? Date.now(),
      sizeBytes: serialized.length,
      parsed: structuredClone(store),
      serialized,
    });
    return false;
  }

  serializedWriteCache.set(storePath, serialized);
  writeStats.performed += 1;
  readCache.set(storePath, {
    mtimeMs: Date.now(),
    sizeBytes: serialized.length,
    parsed: structuredClone(store),
    serialized,
  });
  return true;
}

export function noteSessionsJsonWritten(storePath: string, serialized: string, store: Record<string, unknown>): void {
  serializedWriteCache.set(storePath, serialized);
  readCache.set(storePath, {
    mtimeMs: Date.now(),
    sizeBytes: serialized.length,
    parsed: structuredClone(store),
    serialized,
  });
}
