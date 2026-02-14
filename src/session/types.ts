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

/** Session statistics */
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

/** Export format */
export type ExportFormat = 'json' | 'markdown';

/** Session export data */
export interface SessionExport {
  version: string;
  exportedAt: string;
  metadata: SessionMetadata;
  messages: Message[];
}
