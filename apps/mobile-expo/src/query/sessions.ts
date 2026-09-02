import {
  buildCreateSessionPath,
  buildSessionActionPath,
  buildSessionDetailPath,
  buildSessionHistoryPath,
  buildSessionListPath,
  buildSessionRunPath,
  extractCreatedSessionKey,
  normalizeSessionActiveRunResponse,
  parseSessionMessagePage,
  parseSessionResponse,
  parseSessionsListResponse,
  tryParseSessionListItem,
  type SessionListItem as GatewaySessionListItem,
  type SessionRoutingMeta as GatewaySessionRoutingMeta,
  type SessionStatus as GatewaySessionStatus,
  type SessionsListResponse,
  type SessionCreateRequest,
  modelPreferenceForAgent,
  createDefaultNewSessionPreferences,
} from '@xopcai/gateway-contract';

import { apiFetch, formatApiHttpError } from '../api/client';
import {
  readCachedSessions,
  writeCachedSessions,
} from '../features/gateway/sessions-cache';
import { useGatewayStore } from '../stores/gateway-store';
import { usePreferencesStore } from '../stores/preferences-store';
import { setSessionInitialAgentConfig } from './models';

// ── Types ────────────────────────────────────────────────────────

export type SessionStatus = GatewaySessionStatus;

export type SessionListItem = GatewaySessionListItem;

export type SessionMessage = {
  role: string;
  content: unknown;
  timestamp?: string | number;
};

export type SessionDetail = {
  key: string;
  sessionId?: string;
  messages: SessionMessage[];
  name?: string;
  status?: SessionStatus;
  sourceChannel?: string;
  sourceChatId?: string;
  projectId?: string;
  customData?: Record<string, unknown>;
  routing?: SessionRoutingMeta;
};

export type SessionRoutingMeta = GatewaySessionRoutingMeta;

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
  const channel = options?.channel === undefined ? 'webchat' : options.channel;

  const res = await apiFetch(buildSessionListPath({
    limit,
    offset,
    search: search || undefined,
    channel,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  }));
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  const raw = await res.json();
  let parsed: SessionsListResponse;
  try {
    parsed = parseSessionsListResponse(raw);
  } catch {
    throw new Error('Invalid sessions response');
  }
  const items: SessionListItem[] = [];
  for (const row of parsed.items) {
    const item = tryParseSessionListItem(row);
    if (item) items.push(normalizeSessionListItem(item));
  }
  // Persist only the unfiltered first page so cold-start hydration matches
  // the next live first request.
  if (offset === 0 && !search) {
    writeCachedSessions(useGatewayStore.getState().activeGatewayId, items);
  }
  return {
    items,
    total: parsed.total,
    limit: parsed.limit,
    offset: parsed.offset,
    hasMore: parsed.hasMore,
  };
}

/** Last-known session list for the active profile; used as react-query
 * `placeholderData` so the drawer renders instantly while the live request
 * fans out behind the scenes. */
export function readPlaceholderSessions(): SessionListItem[] | null {
  return readCachedSessions(useGatewayStore.getState().activeGatewayId);
}

export async function fetchSession(key: string): Promise<SessionDetail | null> {
  const res = await apiFetch(buildSessionDetailPath(key));
  if (res.status === 404) return null;
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  const data = parseSessionResponse(await res.json());
  return data.session ?? null;
}

export async function fetchSessionActiveRun(key: string): Promise<SessionActiveRunPayload> {
  const normalizedKey = key.trim();
  if (!normalizedKey) return { active: false };

  const res = await apiFetch(buildSessionRunPath(normalizedKey));
  if (res.status === 404) return { active: false };
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  return normalizeSessionActiveRunResponse(await res.json());
}

export async function fetchSessionMessagePage(
  key: string,
  options?: { limit?: number; before?: string },
): Promise<SessionMessagePage | null> {
  const res = await apiFetch(buildSessionHistoryPath(key, options));
  if (res.status === 404) return null;
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  return parseSessionMessagePage(await res.json());
}

export async function createSession(
  input: Omit<SessionCreateRequest, 'channel'> = {},
): Promise<string> {
  const body: SessionCreateRequest = { channel: 'webchat' };
  if (input.agentId?.trim()) body.agentId = input.agentId.trim().toLowerCase();
  if (input.projectId?.trim()) body.projectId = input.projectId.trim();
  if (input.temporary === true) body.temporary = true;
  const gatewayId = useGatewayStore.getState().activeGatewayId ?? '';
  const preferences = usePreferencesStore.getState()
    .newSessionPreferencesByGateway[gatewayId] ?? createDefaultNewSessionPreferences();
  const requestedPreference = body.agentId
    ? modelPreferenceForAgent(preferences, body.agentId)
    : undefined;
  body.initialAgentConfig = input.initialAgentConfig ?? (requestedPreference
    ? {
        model: requestedPreference.modelRef,
        ...(requestedPreference.thinkingLevel
          ? { thinkingLevel: requestedPreference.thinkingLevel }
          : {}),
      }
    : undefined);
  const res = await apiFetch(buildCreateSessionPath(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
  const raw = await res.json();
  const sessionKey = extractCreatedSessionKey(raw);
  if (!body.initialAgentConfig) {
    const routedAgentId = (raw as { session?: { routing?: { agentId?: unknown } } })
      .session?.routing?.agentId;
    const routedPreference = typeof routedAgentId === 'string'
      ? modelPreferenceForAgent(preferences, routedAgentId)
      : undefined;
    if (routedPreference) {
      await setSessionInitialAgentConfig(sessionKey, {
        model: routedPreference.modelRef,
        ...(routedPreference.thinkingLevel
          ? { thinkingLevel: routedPreference.thinkingLevel }
          : {}),
      });
    }
  }
  return sessionKey;
}

// ── Session actions ──────────────────────────────────────────────

export async function deleteSession(key: string): Promise<void> {
  const res = await apiFetch(buildSessionActionPath(key, 'delete'), { method: 'DELETE' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function renameSession(key: string, name: string): Promise<void> {
  const res = await apiFetch(buildSessionActionPath(key, 'rename'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function archiveSession(key: string): Promise<void> {
  const res = await apiFetch(buildSessionActionPath(key, 'archive'), { method: 'POST' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function unarchiveSession(key: string): Promise<void> {
  const res = await apiFetch(buildSessionActionPath(key, 'unarchive'), { method: 'POST' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function pinSession(key: string): Promise<void> {
  const res = await apiFetch(buildSessionActionPath(key, 'pin'), { method: 'POST' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

export async function unpinSession(key: string): Promise<void> {
  const res = await apiFetch(buildSessionActionPath(key, 'unpin'), { method: 'POST' });
  if (!res.ok) throwApiError(res, await parseErrorBody(res));
}

// ── Hook ─────────────────────────────────────────────────────────

export function useGatewayConfigured(): boolean {
  return useGatewayStore((s) => s.getActiveProfile() !== null);
}
