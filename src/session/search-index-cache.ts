/**
 * Shared cache for {@link SessionSearchIndex} builds (invalidated on session writes).
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { FILENAMES } from '../config/paths.js';
import { SessionSearchIndex } from './search-index.js';

const INDEX_CACHE_TTL_MS = 90_000;

let indexCache: {
  root: string;
  index: SessionSearchIndex;
  indexFileMtime: number;
  builtAt: number;
} | null = null;

export function invalidateSessionSearchIndexCache(): void {
  indexCache = null;
}

export async function getOrLoadSessionSearchIndex(sessionsRoot: string): Promise<SessionSearchIndex> {
  const indexPath = join(sessionsRoot, FILENAMES.SESSIONS_INDEX);
  let mtime = 0;
  try {
    mtime = (await stat(indexPath)).mtimeMs;
  } catch {
    mtime = 0;
  }
  const now = Date.now();
  if (
    indexCache &&
    indexCache.root === sessionsRoot &&
    indexCache.indexFileMtime === mtime &&
    now - indexCache.builtAt < INDEX_CACHE_TTL_MS
  ) {
    return indexCache.index;
  }

  const idx = new SessionSearchIndex();
  await idx.buildIndex(sessionsRoot);

  let m2 = mtime;
  try {
    m2 = (await stat(indexPath)).mtimeMs;
  } catch {
    m2 = Date.now();
  }

  indexCache = {
    root: sessionsRoot,
    index: idx,
    indexFileMtime: m2,
    builtAt: Date.now(),
  };
  return idx;
}
