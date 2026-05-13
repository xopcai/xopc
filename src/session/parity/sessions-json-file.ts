import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

import lockfile from 'proper-lockfile';

import { writeTextAtomic } from '../../infra/write-file-atomic.js';

export type SessionsJsonMap<T> = Record<string, T>;

async function ensureDirForFile(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

/**
 * Read JSON object from `sessions.json`. Missing file → `{}`.
 */
export async function readSessionsJsonFile<T extends Record<string, unknown>>(
  storePath: string,
): Promise<SessionsJsonMap<T>> {
  try {
    const raw = await readFile(storePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as SessionsJsonMap<T>;
  } catch {
    return {};
  }
}

/**
 * Exclusive update: lock → read → mutate → atomic write → unlock.
 */
export async function withSessionsJsonLock<T>(
  storePath: string,
  fn: (store: SessionsJsonMap<Record<string, unknown>>) => Promise<T>,
): Promise<T> {
  await ensureDirForFile(storePath);
  if (!existsSync(storePath)) {
    await writeTextAtomic(storePath, '{}\n');
  }
  const release = await lockfile.lock(storePath, {
    retries: {
      retries: 30,
      minTimeout: 50,
      maxTimeout: 500,
    },
  });
  try {
    const data = await readSessionsJsonFile(storePath);
    const result = await fn(data);
    await writeTextAtomic(storePath, `${JSON.stringify(data, null, 2)}\n`);
    return result;
  } finally {
    await release();
  }
}
