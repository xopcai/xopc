import { readFile } from 'node:fs/promises';

import type { SessionsJsonMap } from './sessions-json-file.js';

/**
 * Raw disk read for sessions.json (no in-memory cache).
 */
export async function readSessionsJsonFileRaw<T extends Record<string, unknown>>(
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
