import { readFile } from 'node:fs/promises';

// Type duplicated inline — `sessions-json-file.ts` imports a value from this
// file (cache.ts → file-read.ts → file.ts), so re-importing the type back
// would close the loop. The shape is trivial so we declare it locally.
type SessionsJsonMap<T> = Record<string, T>;

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
