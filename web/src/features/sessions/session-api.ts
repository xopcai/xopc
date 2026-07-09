import {
  buildSidebarChatListPath,
  buildSessionActionPath,
  buildSessionDetailPath,
  buildSessionListQueryString,
  buildSessionStatsPath,
  parseSessionActionResponse,
  parseSessionRenameResponse,
  parseSessionResponse,
  parseSessionStatsResponse,
  parseSidebarChatListResponse,
  sessionListDedupeKey,
  type SidebarChatListProject as GatewaySidebarChatListProject,
  type SidebarChatListResponse as GatewaySidebarChatListResponse,
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

export type SidebarChatListProject = GatewaySidebarChatListProject<Project>;
export type SidebarChatListResponse = GatewaySidebarChatListResponse<Project>;

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
  return parseSidebarChatListResponse(
    await fetchJson<unknown>(apiUrl(buildSidebarChatListPath(query))),
  ) as SidebarChatListResponse;
}

export async function getSessionStats(): Promise<SessionStats> {
  return parseSessionStatsResponse(await fetchJson<unknown>(apiUrl(buildSessionStatsPath())));
}

export async function getSessionDetail(
  key: string,
  options?: { includeTranscript?: boolean; includeTranscriptRows?: boolean },
): Promise<SessionDetail> {
  const data = parseSessionResponse(
    await fetchJson<unknown>(apiUrl(buildSessionDetailPath(key, options))),
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
  parseSessionActionResponse(
    await fetchJson<unknown>(apiUrl(buildSessionActionPath(key, 'delete')), { method: 'DELETE' }),
  );
}

export async function renameSession(key: string, name: string): Promise<{ renamed: boolean }> {
  const parsed = parseSessionRenameResponse(
    await fetchJson<unknown>(apiUrl(buildSessionActionPath(key, 'rename')), {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  );
  return { renamed: parsed.renamed === true };
}

export async function archiveSession(key: string): Promise<void> {
  parseSessionActionResponse(
    await fetchJson<unknown>(apiUrl(buildSessionActionPath(key, 'archive')), { method: 'POST' }),
  );
}

export async function unarchiveSession(key: string): Promise<void> {
  parseSessionActionResponse(
    await fetchJson<unknown>(apiUrl(buildSessionActionPath(key, 'unarchive')), { method: 'POST' }),
  );
}

export async function pinSession(key: string): Promise<void> {
  parseSessionActionResponse(
    await fetchJson<unknown>(apiUrl(buildSessionActionPath(key, 'pin')), { method: 'POST' }),
  );
}

export async function unpinSession(key: string): Promise<void> {
  parseSessionActionResponse(
    await fetchJson<unknown>(apiUrl(buildSessionActionPath(key, 'unpin')), { method: 'POST' }),
  );
}

export async function exportSessionJson(key: string): Promise<string> {
  const data = await fetchJson<{ content: string }>(
    apiUrl(`/api/sessions/${encodeURIComponent(key)}/export?format=json`),
  );
  return data.content;
}
