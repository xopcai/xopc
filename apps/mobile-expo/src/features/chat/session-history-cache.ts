import type { SessionMessagePage } from '../../query/sessions';
import {
  QUERY_CACHE_NAMESPACES,
  clearQueryCache,
  readQueryCache,
  writeQueryCache,
} from '../gateway/query-cache';

const MAX_CACHED_HISTORY_PAGES_PER_SESSION = 20;

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

function historyPageScope(conversationId: string, transcriptId: string, before: string): string {
  return `${conversationId}:transcript:${transcriptId}:before:${before}`;
}

function rememberHistoryPage(
  profileId: string,
  conversationId: string,
  scope: string,
): void {
  const previous = readQueryCache<string[]>(
    QUERY_CACHE_NAMESPACES.sessionHistoryPageManifest,
    profileId,
    conversationId,
    { maxAgeMs: Infinity },
  ) ?? [];
  const next = [...previous.filter(value => value !== scope), scope];
  const evicted = next.slice(0, Math.max(0, next.length - MAX_CACHED_HISTORY_PAGES_PER_SESSION));
  evicted.forEach(value => clearQueryCache(QUERY_CACHE_NAMESPACES.sessionHistoryPage, profileId, value));
  writeQueryCache(
    QUERY_CACHE_NAMESPACES.sessionHistoryPageManifest,
    profileId,
    conversationId,
    next.slice(-MAX_CACHED_HISTORY_PAGES_PER_SESSION),
  );
}

/** Historical pages are immutable inside one transcript and can be cached indefinitely. */
export function readCachedSessionHistoryPage(
  profileId: string | null | undefined,
  conversationId: string,
  transcriptId: string | null | undefined,
  before: string,
): SessionMessagePage | null {
  const normalizedConversationId = conversationId.trim();
  const normalizedTranscriptId = transcriptId?.trim();
  const normalizedBefore = before.trim();
  if (!profileId || !normalizedConversationId || !normalizedTranscriptId || !normalizedBefore) return null;
  const page = readQueryCache<SessionMessagePage>(
    QUERY_CACHE_NAMESPACES.sessionHistoryPage,
    profileId,
    historyPageScope(normalizedConversationId, normalizedTranscriptId, normalizedBefore),
    { maxAgeMs: Infinity },
  );
  if (!isSessionMessagePage(page)) return null;
  if (page.session.key !== normalizedConversationId || page.session.transcriptId !== normalizedTranscriptId) return null;
  return page;
}

export function writeCachedSessionHistoryPage(
  profileId: string | null | undefined,
  conversationId: string,
  before: string,
  page: SessionMessagePage | null,
): void {
  const normalizedConversationId = conversationId.trim();
  const normalizedBefore = before.trim();
  const transcriptId = page?.session.transcriptId?.trim();
  if (!profileId || !normalizedConversationId || !normalizedBefore || !transcriptId || !isSessionMessagePage(page)) return;
  if (page.session.key !== normalizedConversationId) return;
  const scope = historyPageScope(normalizedConversationId, transcriptId, normalizedBefore);
  writeQueryCache(
    QUERY_CACHE_NAMESPACES.sessionHistoryPage,
    profileId,
    scope,
    page,
  );
  rememberHistoryPage(profileId, normalizedConversationId, scope);
}
