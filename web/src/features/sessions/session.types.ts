/** Align with gateway `/api/sessions` and `ui` `session-api`. */

export interface SessionMetadata {
  key: string;
  name?: string;
  status: 'active' | 'idle' | 'archived' | 'pinned';
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  messageCount: number;
  estimatedTokens: number;
  compactedCount: number;
  sourceChannel: string;
  sourceChatId: string;
}

export interface SessionDetail extends SessionMetadata {
  messages: Array<{
    role: string;
    content: string | unknown[];
    timestamp?: string;
  }>;
}

export interface SessionListQuery {
  status?: 'active' | 'idle' | 'archived' | 'pinned';
  search?: string;
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
