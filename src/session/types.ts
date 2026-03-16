// Session management types

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'toolResult';
  content: string;
  timestamp?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  name?: string;
}

/** Session status enum */
export enum SessionStatus {
  ACTIVE = 'active',
  IDLE = 'idle',
  ARCHIVED = 'archived',
  PINNED = 'pinned',
}

/** Session routing metadata */
export interface SessionRoutingMeta {
  agentId: string;
  source: string;
  accountId: string;
  peerKind: string;
  peerId: string;
  threadId?: string;
  scopeId?: string;
  mainSessionKey?: string;
  lastRoutePolicy?: 'main' | 'session';
}

/** Session ACP metadata */
export interface SessionAcpMeta {
  backend?: string;
  runtimeSessionName?: string;
  mode?: 'persistent' | 'oneshot';
  state?: 'idle' | 'running' | 'error';
  lastActivityAt?: number;
}

/** Session-level statistics (per session) */
export interface SessionStats {
  messageCount: number;
  tokenCount: number;
  turnCount?: number;
  lastTurnAt?: number;
}

/** Global session statistics (aggregate) */
export interface GlobalSessionStats {
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

/** Session metadata (stored in index) */
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
  customData?: Record<string, unknown>;
  /** Routing metadata */
  routing?: SessionRoutingMeta;
  /** ACP metadata */
  acp?: SessionAcpMeta;
  /** Session statistics */
  stats?: SessionStats;
}

/** Session detail (metadata + messages) */
export interface SessionDetail extends SessionMetadata {
  messages: Message[];
}

/** Session index file structure */
export interface SessionIndex {
  version: string;
  lastUpdated: string;
  sessions: SessionMetadata[];
}

/** Session list query parameters */
export interface SessionListQuery {
  status?: SessionStatus | SessionStatus[];
  channel?: string;
  tags?: string[];
  search?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'messageCount' | 'lastAccessedAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/** Paginated result */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Export format */
export type ExportFormat = 'json' | 'markdown';

/** Session export data */
export interface SessionExport {
  version: string;
  exportedAt: string;
  metadata: SessionMetadata;
  messages: Message[];
}
