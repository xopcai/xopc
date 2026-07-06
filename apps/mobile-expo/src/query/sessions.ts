import { apiFetch, formatApiHttpError } from '../api/client';
import {
  readCachedSessions,
  writeCachedSessions,
} from '../features/gateway/sessions-cache';
import { sessionListItemSchema, sessionsListResponseSchema } from '../config/schema';
import { useGatewayStore } from '../stores/gateway-store';

// ── Types ────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'pinned' | 'archived';

export type SessionListItem = {
  key: string;
  sessionId?: string;
  name?: string;
  title?: string;
  displayName?: string;
  messageCount: number;
  updatedAt: string;
  sourceChannel?: string;
  status?: SessionStatus;
  routing?: SessionRoutingMeta;
};

export type SessionMessage = {
  role: string;
  content: unknown;
  timestamp?: string;
};

export type SessionDetail = {
  key: string;
  sessionId?: string;
  messages: SessionMessage[];
  name?: string;
  status?: SessionStatus;
  sourceChannel?: string;
  sourceChatId?: string;
  routing?: SessionRoutingMeta;
};

export type SessionRoutingMeta = {
  agentId: string;
  source: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId?: string;
  scopeId?: string;
};

export type SessionMessagePage = {
  session: SessionDetail;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    before?: string;
    nextBeforeCursor?: string;
  };
};

export type SessionActiveRunPayload = {
  active: boolean;
  runId?: string;
};

export function emptySessionMessagePage(key: string): SessionMessagePage {
  return {
    session: { key, messages: [] },
    pagination: {
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function throwApiError(res: Response, body: unknown): never {
  const b = body as { error?: { message?: string } } | null;
  throw new Error(formatApiHttpError(res.status, res.statusText, b?.error?.message));
}

async function parseErrorBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

function encKey(key: string): string {
  return encodeURIComponent(key);
}

function normalizedSessionName(item: SessionListItem): string | undefined {
  return item.name?.trim() || item.title?.trim() || item.displayName?.trim() || undefined;
}

function normalizeSessionListItem(item: SessionListItem): SessionListItem {
  return {
    ...item,
    name: normalizedSessionName(item),
  };
}

// ── List / Detail / Create ───────────────────────────────────────

export type SessionsPage = {
  items: SessionListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export async function fetchSessionsList(
  options?: { limit?: number; offset?: number; search?: string; channel?: string | null },
): Promise<SessionsPage> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const search = options?.search?.trim() ?? '';

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  if (options?.channel !== null) params.set('channel', options?.channel ?? 'webchat');
  if (search) params.set('search', search);

  const res = await apiFetch(`/api/sessions?${params.toString()}`);
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  const raw = await res.json();
  const parsed = sessionsListResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid sessions response');
  const items: SessionListItem[] = [];
  for (const row of parsed.data.items) {
    const one = sessionListItemSchema.safeParse(row);
    if (one.success) items.push(normalizeSessionListItem(one.data));
  }
  // Persist only the unfiltered first page so cold-start hydration matches
  // the next live first request.
  if (offset === 0 && !search) {
    writeCachedSessions(useGatewayStore.getState().activeGatewayId, items);
  }
  return {
    items,
    total: parsed.data.total,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    hasMore: parsed.data.hasMore,
  };
}

/** Last-known session list for the active profile; used as react-query
 * `placeholderData` so the drawer renders instantly while the live request
 * fans out behind the scenes. */
export function readPlaceholderSessions(): SessionListItem[] | null {
  return readCachedSessions(useGatewayStore.getState().activeGatewayId);
}

export async function fetchSession(key: string): Promise<SessionDetail | null> {
  const res = await apiFetch(`/api/sessions/${encKey(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  const data = (await res.json()) as { session?: SessionDetail };
  return data.session ?? null;
}

export async function fetchSessionActiveRun(key: string): Promise<SessionActiveRunPayload> {
  const normalizedKey = key.trim();
  if (!normalizedKey) return { active: false };

  const res = await apiFetch(`/api/sessions/${encKey(normalizedKey)}/run`);
  if (res.status === 404) return { active: false };
  if (!res.ok) throwApiError(res, await parseErrorBody(res));

  const data = (await res.json()) as { payload?: SessionActiveRunPayload };
  const payload = data.payload;
  const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
  if (!payload?.active || !runId) return { active: false };
  return { active: true, runId };
}

export async function fetchSessionMessagePage(
  key: string,
  options?: { limit?: number; before?: string },
): Promise<SessionMessagePage | null> {
  const params = new URLSearchParams();
  params.set('limit', String(options?.limit ?? 50));
  const before = options?.before?.trim();
  if (before) {
    params.set('before', before);
  }

  const res = await apiFetch(`/api/sessions/${encKey(key)}/history?${params.toString()}`);
  if (res.status === 404) return null;
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  return (await res.json()) as SessionMessagePage;
}

export async function createSession(
  agentId?: string,
): Promise<string> {
  const body: Record<string, unknown> = { channel: 'webchat' };
  if (agentId?.trim()) body.agentId = agentId.trim().toLowerCase();
  const res = await apiFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  const data = (await res.json()) as { session?: { key?: string } };
  const key = data.session?.key;
  if (typeof key !== 'string' || !key.trim()) throw new Error('Create session: missing key');
  return key.trim();
}

// ── Session actions ──────────────────────────────────────────────

export async function deleteSession(key: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encKey(key)}`, { method: 'DELETE' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function renameSession(key: string, name: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encKey(key)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function archiveSession(key: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encKey(key)}/archive`, { method: 'POST' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function unarchiveSession(key: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encKey(key)}/unarchive`, { method: 'POST' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function pinSession(key: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encKey(key)}/pin`, { method: 'POST' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function unpinSession(key: string): Promise<void> {
  const res = await apiFetch(`/api/sessions/${encKey(key)}/unpin`, { method: 'POST' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

// ── Hook ─────────────────────────────────────────────────────────

export function useGatewayConfigured(): boolean {
  return useGatewayStore((s) => Boolean(s.baseUrl.trim()));
}
