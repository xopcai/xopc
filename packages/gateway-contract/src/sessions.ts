import { z } from 'zod';

export type SessionStatus = 'active' | 'idle' | 'archived' | 'pinned';

export interface SessionRoutingMeta {
  agentId?: string;
  source?: string;
  accountId?: string;
  peerKind?: string;
  peerId?: string;
  threadId?: string;
  scopeId?: string;
}

export interface SessionListItem {
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
}

export interface SessionMetadata {
  key: string;
  name?: string;
  status: SessionStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  messageCount: number;
  estimatedTokens: number;
  compactedCount: number;
  sourceChannel: string;
  sourceChatId: string;
  projectId?: string;
  routing?: {
    agentId?: string;
  };
  sessionType?: string;
  customData?: Record<string, unknown>;
  sessionId?: string;
  sessionStartedAt?: string;
  lastInteractionAt?: string;
}

export interface SessionTranscriptSummary {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  compactionCount: number;
}

export interface SessionMessage {
  role: string;
  content: string | unknown[];
  timestamp?: string;
}

export interface SessionDetail extends SessionMetadata {
  messages: SessionMessage[];
  transcriptSummary?: SessionTranscriptSummary;
  transcriptRows?: unknown[];
}

export interface SessionListQuery {
  status?: SessionStatus;
  search?: string;
  channel?: string | null;
  projectId?: string;
  unassigned?: boolean;
  updatedAfter?: number;
  includePinned?: boolean;
  includeSessionKey?: string;
  sessionTypes?: string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc' | string;
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export type SessionsListResponse = PaginatedResult<unknown>;

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  archivedSessions: number;
  pinnedSessions: number;
  totalMessages: number;
  totalTokens: number;
  oldestSession?: string;
  newestSession?: string;
  byChannel: Record<string, number>;
}

export interface SessionActiveRunPayload {
  active: boolean;
  runId?: string;
}

export interface SessionMessagePage {
  session: {
    key: string;
    sessionId?: string;
    messages: SessionMessage[];
    name?: string;
    status?: SessionStatus;
    sourceChannel?: string;
    sourceChatId?: string;
    routing?: SessionRoutingMeta;
  };
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    before?: string;
    nextBeforeCursor?: string;
  };
}

export interface SessionsPage {
  items: SessionListItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const sessionStatusSchema = z.enum(['active', 'idle', 'archived', 'pinned']);

export const sessionRoutingMetaSchema = z
  .object({
    agentId: z.string().optional(),
    source: z.string().optional(),
    accountId: z.string().optional(),
    peerKind: z.string().optional(),
    peerId: z.string().optional(),
    threadId: z.string().optional(),
    scopeId: z.string().optional(),
  })
  .passthrough();

export const sessionListItemSchema = z
  .object({
    key: z.string(),
    sessionId: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    displayName: z.string().optional(),
    messageCount: z.number(),
    updatedAt: z.string(),
    sourceChannel: z.string().optional(),
    status: sessionStatusSchema.optional(),
    routing: sessionRoutingMetaSchema.optional(),
  })
  .passthrough();

export const sessionsListResponseSchema = z.object({
  items: z.array(z.unknown()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

export function parseSessionsListResponse(raw: unknown): SessionsListResponse {
  return sessionsListResponseSchema.parse(raw);
}

export function tryParseSessionListItem(raw: unknown): SessionListItem | null {
  const parsed = sessionListItemSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function buildSessionListQueryString(query?: SessionListQuery): string {
  const params = new URLSearchParams();
  if (!query) return '';
  if (query.status) params.set('status', query.status);
  if (query.search) params.set('search', query.search);
  if (query.channel) params.set('channel', query.channel);
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.unassigned) params.set('unassigned', 'true');
  if (query.updatedAfter != null) params.set('updatedAfter', String(query.updatedAfter));
  if (query.includePinned) params.set('includePinned', 'true');
  if (query.includeSessionKey) params.set('includeSessionKey', query.includeSessionKey);
  if (query.sessionTypes?.length) params.set('types', query.sessionTypes.join(','));
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function buildSessionListPath(query?: SessionListQuery): string {
  return `/api/sessions${buildSessionListQueryString(query)}`;
}

export function sessionListDedupeKey(query?: SessionListQuery): string {
  if (!query) return 'default';
  return JSON.stringify({
    status: query.status,
    search: query.search,
    channel: query.channel,
    projectId: query.projectId,
    unassigned: query.unassigned,
    updatedAfter: query.updatedAfter,
    includePinned: query.includePinned,
    includeSessionKey: query.includeSessionKey,
    sessionTypes: query.sessionTypes,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    offset: query.offset,
  });
}
