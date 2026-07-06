/**
 * Persisted last-known session detail per session key. Lets the chat screen
 * render its history instantly when re-opening a session, while the live
 * fetch confirms / updates in the background. Each session is its own scope
 * so re-opening session A doesn't bleed into session B.
 */
import type { SessionDetail } from '../../query/sessions';

import {
  QUERY_CACHE_NAMESPACES,
  clearQueryCache,
  readQueryCache,
  writeQueryCache,
} from './query-cache';

export function readCachedSessionDetail(
  profileId: string | null | undefined,
  sessionKey: string,
): SessionDetail | null {
  if (!sessionKey) return null;
  return readQueryCache<SessionDetail>(
    QUERY_CACHE_NAMESPACES.sessionDetail,
    profileId,
    sessionKey,
  );
}

export function writeCachedSessionDetail(
  profileId: string | null | undefined,
  sessionKey: string,
  detail: SessionDetail,
): void {
  if (!sessionKey) return;
  writeQueryCache(
    QUERY_CACHE_NAMESPACES.sessionDetail,
    profileId,
    sessionKey,
    detail,
  );
}

export function clearCachedSessionDetail(
  profileId: string | null | undefined,
  sessionKey?: string,
): void {
  if (!sessionKey) return;
  clearQueryCache(QUERY_CACHE_NAMESPACES.sessionDetail, profileId, sessionKey);
}
