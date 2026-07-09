import {
  buildSessionListQueryString,
  sessionListDedupeKey,
} from '@xopcai/gateway-contract';

import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { Project } from '@/features/projects/api';

import type {
  PaginatedResult,
  SessionDetail,
  SessionListQuery,
  SessionMetadata,
  SessionStats,
} from '@/features/sessions/session.types';

const listSessionsInflight = new Map<string, Promise<PaginatedResult<SessionMetadata>>>();

export type SidebarChatListProject = {
  project: Project;
  sessions: SessionMetadata[];
  sessionTotal: number;
  sessionHasMore: boolean;
};

export type SidebarChatListResponse = {
  ok: true;
  projects: PaginatedResult<SidebarChatListProject>;
  inbox: PaginatedResult<SessionMetadata>;
};

/**
 * List sessions (paginated). Concurrent calls with the same query share one HTTP request so the
 * sidebar and chat initial fetch do not triple-fetch the first page on load.
 */
export async function listSessions(query?: SessionListQuery): Promise<PaginatedResult<SessionMetadata>> {
  const key = sessionListDedupeKey(query);
  const existing = listSessionsInflight.get(key);
  if (existing) return existing;

  const url = apiUrl(`/api/sessions${buildSessionListQueryString(query)}`);
  const pending = (async () => {
    const res = await apiFetchWithStartupRetry(url);
    if (!res.ok) {
      const errorBody = (await res.json().catch(() => ({}))) as {
        error?: string | { message?: string };
      };
      const serverMessage =
        typeof errorBody.error === 'string' ? errorBody.error : errorBody.error?.message;
      throw new Error(serverMessage ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as PaginatedResult<SessionMetadata>;
  })().finally(() => {
    listSessionsInflight.delete(key);
  });
  listSessionsInflight.set(key, pending);
  return pending;
}

export async function fetchSidebarChatList(query?: {
  projectLimit?: number;
  projectOffset?: number;
  sessionPreviewLimit?: number;
  inboxLimit?: number;
  inboxOffset?: number;
  staleDays?: number;
  includeSessionKey?: string;
}): Promise<SidebarChatListResponse> {
  const params = new URLSearchParams();
  if (query?.projectLimit != null) params.set('projectLimit', String(query.projectLimit));
  if (query?.projectOffset != null) params.set('projectOffset', String(query.projectOffset));
  if (query?.sessionPreviewLimit != null) {
    params.set('sessionPreviewLimit', String(query.sessionPreviewLimit));
  }
  if (query?.inboxLimit != null) params.set('inboxLimit', String(query.inboxLimit));
  if (query?.inboxOffset != null) params.set('inboxOffset', String(query.inboxOffset));
  if (query?.staleDays != null) params.set('staleDays', String(query.staleDays));
  if (query?.includeSessionKey) params.set('includeSessionKey', query.includeSessionKey);
  const qs = params.toString();
  return fetchJson<SidebarChatListResponse>(apiUrl(`/api/sidebar/chat-list${qs ? `?${qs}` : ''}`));
}

export async function getSessionStats(): Promise<SessionStats> {
  return fetchJson<SessionStats>(apiUrl('/api/sessions/stats'));
}

export async function getSessionDetail(
  key: string,
  options?: { includeTranscript?: boolean; includeTranscriptRows?: boolean },
): Promise<SessionDetail> {
  const includeParts: string[] = [];
  if (options?.includeTranscript) includeParts.push('transcript');
  if (options?.includeTranscriptRows) includeParts.push('transcriptRows');
  const qs = includeParts.length ? `?include=${includeParts.join(',')}` : '';
  const data = await fetchJson<{ session: SessionDetail }>(
    apiUrl(`/api/sessions/${encodeURIComponent(key)}${qs}`),
  );
  if (!data.session) throw new Error('Session not found');
  return data.session;
}

export async function resolveSession(
  input: { sessionId?: string; sessionKey?: string; key?: string },
): Promise<{ sessionKey: string; sessionId: string; session: SessionDetail }> {
  const data = await fetchJson<{
    ok: boolean;
    payload?: { sessionKey: string; sessionId: string; session: SessionDetail };
    error?: string;
  }>(apiUrl('/api/sessions/resolve'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!data.ok || !data.payload) {
    throw new Error(data.error ?? 'Session not found');
  }
  return data.payload;
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
