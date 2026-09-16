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
  conversationId: string,
): SessionMessagePage | null {
  const normalizedConversationId = conversationId.trim();
  if (!profileId || !normalizedConversationId) return null;

  const page = readQueryCache<SessionMessagePage>(
    QUERY_CACHE_NAMESPACES.sessionHistory,
    profileId,
    normalizedConversationId,
    { maxAgeMs: Infinity },
  );
  if (!isSessionMessagePage(page) || page.session.key !== normalizedConversationId) return null;
  return page;
}

export function writeCachedSessionHistoryHead(
  profileId: string | null | undefined,
  conversationId: string,
  page: SessionMessagePage | null,
): void {
  const normalizedConversationId = conversationId.trim();
  if (!profileId || !normalizedConversationId || !isSessionMessagePage(page)) return;
  if (page.session.key !== normalizedConversationId) return;

  writeQueryCache(
    QUERY_CACHE_NAMESPACES.sessionHistory,
    profileId,
    normalizedConversationId,
    page,
  );
}
