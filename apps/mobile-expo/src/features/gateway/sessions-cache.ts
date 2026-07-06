/**
 * Persisted session-list cache. Thin wrapper around the generic query cache
 * so the chat drawer can render instantly on cold start while the live
 * request fans out.
 */
import type { SessionListItem } from '../../query/sessions';

import {
  QUERY_CACHE_NAMESPACES,
  clearQueryCache,
  readQueryCache,
  writeQueryCache,
} from './query-cache';

export function readCachedSessions(profileId: string | null | undefined): SessionListItem[] | null {
  return readQueryCache<SessionListItem[]>(QUERY_CACHE_NAMESPACES.sessions, profileId);
}

export function writeCachedSessions(
  profileId: string | null | undefined,
  items: SessionListItem[],
): void {
  writeQueryCache(QUERY_CACHE_NAMESPACES.sessions, profileId, undefined, items);
}

export function clearCachedSessions(profileId: string | null | undefined): void {
  clearQueryCache(QUERY_CACHE_NAMESPACES.sessions, profileId);
}
