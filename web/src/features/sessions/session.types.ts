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
  /** Gateway session index: which agent owns this session (when set). */
  routing?: {
    agentId?: string;
  };
  customData?: Record<string, unknown>;
  /** Stable wrapped-transcript id (same as on-disk envelope id). */
  transcriptId?: string;
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

export interface SessionDetail extends SessionMetadata {
  messages: Array<{
    role: string;
    content: string | unknown[];
    timestamp?: string;
  }>;
  transcriptSummary?: SessionTranscriptSummary;
}

export interface SessionListQuery {
  status?: 'active' | 'idle' | 'archived' | 'pinned';
  search?: string;
  /** Filter by `SessionMetadata.sourceChannel`, or comma-separated IM channels (e.g. `telegram,weixin`). */
  channel?: string;
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
