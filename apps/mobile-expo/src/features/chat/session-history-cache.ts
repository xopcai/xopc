import type { SessionMessagePage } from '../../query/sessions';
import {
  QUERY_CACHE_NAMESPACES,
  readQueryCache,
  writeQueryCache,
} from '../gateway/query-cache';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionMessagePage(value: unknown): value is SessionMessagePage {
  if (!isRecord(value)) return false;
  if (!isRecord(value.session)) return false;
  if (typeof value.session.key !== 'string' || !Array.isArray(value.session.messages)) return false;
  if (!isRecord(value.pagination)) return false;
  return typeof value.pagination.limit === 'number'
    && typeof value.pagination.hasMore === 'boolean';
}

export function readCachedSessionHistoryHead(
  profileId: string | null | undefined,
  sessionKey: string,
): SessionMessagePage | null {
  const normalizedSessionKey = sessionKey.trim();
  if (!profileId || !normalizedSessionKey) return null;

  const page = readQueryCache<SessionMessagePage>(
    QUERY_CACHE_NAMESPACES.sessionHistory,
    profileId,
    normalizedSessionKey,
  );
  if (!isSessionMessagePage(page) || page.session.key !== normalizedSessionKey) return null;
  return page;
}

export function writeCachedSessionHistoryHead(
  profileId: string | null | undefined,
  sessionKey: string,
  page: SessionMessagePage | null,
): void {
  const normalizedSessionKey = sessionKey.trim();
  if (!profileId || !normalizedSessionKey || !isSessionMessagePage(page)) return;
  if (page.session.key !== normalizedSessionKey) return;

  writeQueryCache(
    QUERY_CACHE_NAMESPACES.sessionHistory,
    profileId,
    normalizedSessionKey,
    page,
  );
}
