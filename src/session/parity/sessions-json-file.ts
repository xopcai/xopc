import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

import lockfile from 'proper-lockfile';

import { writeTextAtomic } from '../../infra/write-file-atomic.js';
import {
  commitSessionsJsonWrite,
  invalidateSessionsJsonCache,
  noteSessionsJsonWritten,
  readSessionsJsonCached,
} from './sessions-json-cache.js';
import { readSessionsJsonFileRaw } from './sessions-json-file-read.js';

export type SessionsJsonMap<T> = Record<string, T>;

async function ensureDirForFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function serializeSessionsJson(store: Record<string, unknown>): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

/**
 * Read JSON object from `sessions.json`. Missing file → `{}`.
 * Uses mtime/size cache when enabled.
 */
export async function readSessionsJsonFile<T extends Record<string, unknown>>(
  storePath: string,
): Promise<SessionsJsonMap<T>> {
  if (!existsSync(storePath)) {
    return {};
  }
  const { store } = await readSessionsJsonCached(storePath);
  return store as SessionsJsonMap<T>;
}

/**
 * Exclusive update: lock → read → mutate → atomic write (skipped when serialized unchanged) → unlock.
 */
export async function withSessionsJsonLock<T>(
  storePath: string,
  fn: (store: SessionsJsonMap<Record<string, unknown>>) => Promise<T>,
): Promise<T> {
  await ensureDirForFile(storePath);
  if (!existsSync(storePath)) {
    await writeTextAtomic(storePath, '{}\n');
    noteSessionsJsonWritten(storePath, '{}\n', {});
  }
  const release = await lockfile.lock(storePath, {
    retries: {
      retries: 30,
      minTimeout: 50,
      maxTimeout: 500,
    },
  });
  try {
    const data = existsSync(storePath)
      ? await readSessionsJsonFileRaw<Record<string, unknown>>(storePath)
      : {};
    const result = await fn(data);
    const serialized = serializeSessionsJson(data);
    if (commitSessionsJsonWrite(storePath, data, serialized)) {
      await writeTextAtomic(storePath, serialized);
    }
    return result;
  } finally {
    await release();
  }
}

export { invalidateSessionsJsonCache, getSessionsJsonWriteStats, resetSessionsJsonCacheForTest } from './sessions-json-cache.js';
