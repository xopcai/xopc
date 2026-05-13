import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  PaginatedResult,
  SessionDetail,
  SessionListQuery,
  SessionMetadata,
  SessionStats,
} from '@/features/sessions/session.types';

function buildListQuery(query?: SessionListQuery): string {
  const params = new URLSearchParams();
  if (!query) return '';
  if (query.status) params.set('status', query.status);
  if (query.search) params.set('search', query.search);
  if (query.channel) params.set('channel', query.channel);
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function listSessionsDedupeKey(query?: SessionListQuery): string {
  if (!query) return 'default';
  return JSON.stringify({
    status: query.status,
    search: query.search,
    channel: query.channel,
    limit: query.limit,
    offset: query.offset,
  });
}

const listSessionsInflight = new Map<string, Promise<PaginatedResult<SessionMetadata>>>();

/**
 * List sessions (paginated). Concurrent calls with the same query share one HTTP request so the
 * sidebar and chat initial fetch do not triple-fetch the first page on load.
 */
export async function listSessions(query?: SessionListQuery): Promise<PaginatedResult<SessionMetadata>> {
  const key = listSessionsDedupeKey(query);
  const existing = listSessionsInflight.get(key);
  if (existing) return existing;

  const url = apiUrl(`/api/sessions${buildListQuery(query)}`);
  const pending = fetchJson<PaginatedResult<SessionMetadata>>(url).finally(() => {
    listSessionsInflight.delete(key);
  });
  listSessionsInflight.set(key, pending);
  return pending;
}

export async function getSessionStats(): Promise<SessionStats> {
  return fetchJson<SessionStats>(apiUrl('/api/sessions/stats'));
}

export async function getSessionDetail(
  key: string,
  options?: { includeTranscript?: boolean },
): Promise<SessionDetail> {
  const qs = options?.includeTranscript ? '?include=transcript' : '';
  const data = await fetchJson<{ session: SessionDetail }>(
    apiUrl(`/api/sessions/${encodeURIComponent(key)}${qs}`),
  );
  if (!data.session) throw new Error('Session not found');
  return data.session;
}

export type SessionPatchPayload = {
  name?: string;
  tags?: string[];
  replaceTags?: boolean;
  customData?: Record<string, unknown>;
};

export async function patchSession(
  key: string,
  patch: SessionPatchPayload,
): Promise<SessionDetail> {
  const data = await fetchJson<{ ok: boolean; session?: SessionDetail; error?: string }>(
    apiUrl(`/api/sessions/${encodeURIComponent(key)}`),
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  if (!data.ok || !data.session) {
    throw new Error(data.error || 'PATCH session failed');
  }
  return data.session;
}

export async function deleteSession(key: string): Promise<void> {
  await fetchJson(apiUrl(`/api/sessions/${encodeURIComponent(key)}`), { method: 'DELETE' });
}

export async function renameSession(key: string, name: string): Promise<{ renamed: boolean }> {
  return fetchJson<{ renamed: boolean }>(apiUrl(`/api/sessions/${encodeURIComponent(key)}/rename`), {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function archiveSession(key: string): Promise<void> {
  await fetchJson(apiUrl(`/api/sessions/${encodeURIComponent(key)}/archive`), { method: 'POST' });
}

export async function unarchiveSession(key: string): Promise<void> {
  await fetchJson(apiUrl(`/api/sessions/${encodeURIComponent(key)}/unarchive`), { method: 'POST' });
}

export async function pinSession(key: string): Promise<void> {
  await fetchJson(apiUrl(`/api/sessions/${encodeURIComponent(key)}/pin`), { method: 'POST' });
}

export async function unpinSession(key: string): Promise<void> {
  await fetchJson(apiUrl(`/api/sessions/${encodeURIComponent(key)}/unpin`), { method: 'POST' });
}

export async function exportSessionJson(key: string): Promise<string> {
  const data = await fetchJson<{ content: string }>(
    apiUrl(`/api/sessions/${encodeURIComponent(key)}/export?format=json`),
  );
  return data.content;
}
