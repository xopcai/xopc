import { z } from 'zod';

export type SessionStatus = 'active' | 'idle' | 'archived' | 'pinned';

/** Current associations, not a record of what a model has read. */
export interface SessionContextSource {
  kind: 'note';
  id: string;
  title?: string;
  unavailable?: boolean;
  origins: Array<{ kind: 'session' | 'task'; version?: string }>;
}

export interface SessionContextSummary {
  sessionKey: string;
  observedAt: string;
  work: {
    project?: { id: string; title: string };
    task?: { id: string; title: string; phase: string };
  };
  sources: SessionContextSource[];
  sourcesHasMore: boolean;
  environment?: {
    kind: 'local_checkout' | 'managed_worktree';
    rootPath: string;
    available: boolean;
    branch?: string;
    headSha?: string;
    detached?: boolean;
  };
  unavailableSections: Array<'work' | 'sources' | 'environment'>;
}

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
  parentSessionKey?: string;
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
  timestamp?: string | number;
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

export interface SessionResponse {
  session: SessionDetail;
}

export interface SessionCreateResponse {
  session: {
    key: string;
    sessionId?: string;
    projectId?: string;
    routing?: SessionRoutingMeta;
  };
}

export interface SessionInitialAgentConfig {
  model?: string;
  thinkingLevel?: string;
}

export interface SessionCreateRequest {
  channel?: string;
  agentId?: string;
  projectId?: string;
  executionMode?: 'local_checkout' | 'managed_worktree';
  baseRef?: string;
  temporary?: boolean;
  initialAgentConfig?: SessionInitialAgentConfig;
}

export interface SessionForkAtTurnRequest {
  lastTurnId: string;
}

export interface SessionForkAtTurnResponse {
  ok: true;
  sessionKey: string;
  rowCount: number;
  lastTurnId: string;
  session: SessionDetail;
}

export interface SessionMetadataPatchRequest {
  name?: string;
  tags?: string[];
  replaceTags?: boolean;
  customData?: Record<string, unknown>;
  projectId?: string | null;
}

export interface SessionActiveRunResponse {
  ok?: boolean;
  payload?: SessionActiveRunPayload;
}

export interface SessionActionResponse {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface SessionRenameResponse extends SessionActionResponse {
  renamed?: boolean;
}

export interface SessionResetResponse extends SessionActionResponse {
  reset?: boolean;
  sessionId?: string;
  previousSessionId?: string;
  session?: unknown;
}

export interface SessionResolveResponse {
  ok: boolean;
  payload?: {
    sessionKey: string;
    sessionId: string;
    session: unknown;
  };
  error?: string;
}

export interface SidebarChatListProject<TProject = unknown> {
  project: TProject;
  sessions: SessionMetadata[];
  sessionTotal: number;
  sessionHasMore: boolean;
}

export interface SidebarChatListResponse<TProject = unknown> {
  ok: true;
  projects: PaginatedResult<SidebarChatListProject<TProject>>;
  inbox: PaginatedResult<SessionMetadata>;
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
    projectId?: string;
    customData?: Record<string, unknown>;
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

export const sessionMessageSchema = z
  .object({
    role: z.string(),
    content: z.unknown(),
    timestamp: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const sessionDetailSchema = z
  .object({
    key: z.string(),
    messages: z.array(sessionMessageSchema),
  })
  .passthrough();

export const sessionResponseSchema = z.object({
  session: sessionDetailSchema,
});

export const sessionMessagePageSchema = z
  .object({
    session: z
      .object({
        key: z.string(),
        sessionId: z.string().optional(),
        messages: z.array(sessionMessageSchema),
        name: z.string().optional(),
        status: sessionStatusSchema.optional(),
        sourceChannel: z.string().optional(),
        sourceChatId: z.string().optional(),
        projectId: z.string().optional(),
        customData: z.record(z.string(), z.unknown()).optional(),
        routing: sessionRoutingMetaSchema.optional(),
      })
      .passthrough(),
    pagination: z
      .object({
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
        hasMore: z.boolean(),
        before: z.string().optional(),
        nextBeforeCursor: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const sessionCreateResponseSchema = z
  .object({
    session: z
      .object({
        key: z.string(),
        sessionId: z.string().optional(),
        projectId: z.string().optional(),
        routing: sessionRoutingMetaSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const sessionForkAtTurnResponseSchema = z
  .object({
    ok: z.literal(true),
    sessionKey: z.string().min(1),
    rowCount: z.number().int().nonnegative(),
    lastTurnId: z.string().min(1),
    session: sessionDetailSchema,
  })
  .passthrough();

export const sessionActiveRunResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    payload: z
      .object({
        active: z.boolean(),
        runId: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const sessionActionResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const sessionRenameResponseSchema = sessionActionResponseSchema.extend({
  renamed: z.boolean().optional(),
});

export const sessionResetResponseSchema = sessionActionResponseSchema.extend({
  reset: z.boolean().optional(),
  sessionId: z.string().optional(),
  previousSessionId: z.string().optional(),
  session: z.unknown().optional(),
});

export const sessionStatsResponseSchema = z
  .object({
    totalSessions: z.number(),
    activeSessions: z.number(),
    archivedSessions: z.number(),
    pinnedSessions: z.number(),
    totalMessages: z.number(),
    totalTokens: z.number(),
    oldestSession: z.string().optional(),
    newestSession: z.string().optional(),
    byChannel: z.record(z.string(), z.number()),
  })
  .passthrough();

export const sessionResolveResponseSchema = z
  .object({
    ok: z.boolean(),
    payload: z
      .object({
        sessionKey: z.string(),
        sessionId: z.string(),
        session: z.unknown(),
      })
      .passthrough()
      .optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const sidebarChatListResponseSchema = z
  .object({
    ok: z.literal(true),
    projects: z.object({
      items: z.array(
        z
          .object({
            project: z.unknown(),
            sessions: z.array(z.unknown()),
            sessionTotal: z.number(),
            sessionHasMore: z.boolean(),
          })
          .passthrough(),
      ),
      total: z.number(),
      limit: z.number(),
      offset: z.number(),
      hasMore: z.boolean(),
    }),
    inbox: sessionsListResponseSchema,
  })
  .passthrough();

export function parseSessionsListResponse(raw: unknown): SessionsListResponse {
  return sessionsListResponseSchema.parse(raw);
}

export function tryParseSessionListItem(raw: unknown): SessionListItem | null {
  const parsed = sessionListItemSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseSessionResponse(raw: unknown): SessionResponse {
  return sessionResponseSchema.parse(raw) as unknown as SessionResponse;
}

export function parseSessionMessagePage(raw: unknown): SessionMessagePage {
  return sessionMessagePageSchema.parse(raw) as unknown as SessionMessagePage;
}

export function parseSessionCreateResponse(raw: unknown): SessionCreateResponse {
  return sessionCreateResponseSchema.parse(raw) as SessionCreateResponse;
}

export function parseSessionForkAtTurnResponse(raw: unknown): SessionForkAtTurnResponse {
  return sessionForkAtTurnResponseSchema.parse(raw) as unknown as SessionForkAtTurnResponse;
}

export function parseSessionActiveRunResponse(raw: unknown): SessionActiveRunResponse {
  return sessionActiveRunResponseSchema.parse(raw) as SessionActiveRunResponse;
}

export function parseSessionActionResponse(raw: unknown): SessionActionResponse {
  return sessionActionResponseSchema.parse(raw) as SessionActionResponse;
}

export function parseSessionRenameResponse(raw: unknown): SessionRenameResponse {
  return sessionRenameResponseSchema.parse(raw) as SessionRenameResponse;
}

export function parseSessionResetResponse(raw: unknown): SessionResetResponse {
  return sessionResetResponseSchema.parse(raw) as SessionResetResponse;
}

export function parseSessionStatsResponse(raw: unknown): SessionStats {
  return sessionStatsResponseSchema.parse(raw) as SessionStats;
}

export function parseSessionResolveResponse(raw: unknown): SessionResolveResponse {
  return sessionResolveResponseSchema.parse(raw) as SessionResolveResponse;
}

export function parseSidebarChatListResponse(raw: unknown): SidebarChatListResponse {
  return sidebarChatListResponseSchema.parse(raw) as unknown as SidebarChatListResponse;
}

export function normalizeSessionActiveRunResponse(raw: unknown): SessionActiveRunPayload {
  const data = parseSessionActiveRunResponse(raw);
  const payload = data.payload;
  const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
  if (!payload?.active || !runId) return { active: false };
  return { active: true, runId };
}

export function extractCreatedSessionKey(raw: unknown): string {
  const data = parseSessionCreateResponse(raw);
  const key = data.session.key;
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('Create session: missing key');
  }
  return key.trim();
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

export function buildSessionDetailPath(
  key: string,
  options?: { includeTranscript?: boolean; includeTranscriptRows?: boolean },
): string {
  const includeParts: string[] = [];
  if (options?.includeTranscript) includeParts.push('transcript');
  if (options?.includeTranscriptRows) includeParts.push('transcriptRows');
  const qs = includeParts.length ? `?include=${includeParts.join(',')}` : '';
  return `/api/sessions/${encodeURIComponent(key)}${qs}`;
}

export function buildSessionForkAtTurnPath(key: string): string {
  return `/api/sessions/${encodeURIComponent(key)}/fork-at-turn`;
}

export function buildSessionHistoryPath(
  key: string,
  options?: { limit?: number; offset?: number; before?: string | null },
): string {
  const params = new URLSearchParams();
  params.set('limit', String(options?.limit ?? 50));
  const before = options?.before?.trim();
  if (before) {
    params.set('before', before);
  } else if (options?.offset != null) {
    params.set('offset', String(options.offset));
  }
  return `/api/sessions/${encodeURIComponent(key)}/history?${params.toString()}`;
}

export function buildSessionRunPath(key: string): string {
  return `/api/sessions/${encodeURIComponent(key)}/run`;
}

export function buildSessionStatsPath(): string {
  return '/api/sessions/stats';
}

export function buildSessionResolvePath(query?: { sessionId?: string; sessionKey?: string; key?: string }): string {
  const params = new URLSearchParams();
  if (query?.sessionId) params.set('sessionId', query.sessionId);
  if (query?.sessionKey) params.set('sessionKey', query.sessionKey);
  if (query?.key) params.set('key', query.key);
  const qs = params.toString();
  return `/api/sessions/resolve${qs ? `?${qs}` : ''}`;
}

export function buildSidebarChatListPath(query?: {
  projectLimit?: number;
  projectOffset?: number;
  sessionPreviewLimit?: number;
  inboxLimit?: number;
  inboxOffset?: number;
  staleDays?: number;
  includeSessionKey?: string;
}): string {
  const params = new URLSearchParams();
  if (query?.projectLimit != null) params.set('projectLimit', String(query.projectLimit));
  if (query?.projectOffset != null) params.set('projectOffset', String(query.projectOffset));
  if (query?.sessionPreviewLimit != null) params.set('sessionPreviewLimit', String(query.sessionPreviewLimit));
  if (query?.inboxLimit != null) params.set('inboxLimit', String(query.inboxLimit));
  if (query?.inboxOffset != null) params.set('inboxOffset', String(query.inboxOffset));
  if (query?.staleDays != null) params.set('staleDays', String(query.staleDays));
  if (query?.includeSessionKey) params.set('includeSessionKey', query.includeSessionKey);
  const qs = params.toString();
  return `/api/sidebar/chat-list${qs ? `?${qs}` : ''}`;
}

export function buildSessionActionPath(
  key: string,
  action: 'delete' | 'archive' | 'unarchive' | 'pin' | 'unpin' | 'rename' | 'reset',
): string {
  const encoded = encodeURIComponent(key);
  if (action === 'delete') return `/api/sessions/${encoded}`;
  return `/api/sessions/${encoded}/${action}`;
}

export function buildCreateSessionPath(): string {
  return '/api/sessions';
}

export function buildSessionAgentConfigPath(key: string): string {
  return `/api/sessions/${encodeURIComponent(key)}/agent-config`;
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
