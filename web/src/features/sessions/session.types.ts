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
  /** Optional project grouping for sessions, goals, workflows, and related context. */
  projectId?: string;
  /** Gateway session index: which agent owns this session (when set). */
  routing?: {
    agentId?: string;
  };
  sessionType?: string;
  customData?: Record<string, unknown>;
  /** Active OpenClaw-style session instance id. Rotates on reset while `key` stays stable. */
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

export interface SessionDetail extends SessionMetadata {
  messages: Array<{
    role: string;
    content: string | unknown[];
    timestamp?: string;
  }>;
  transcriptSummary?: SessionTranscriptSummary;
  /** When `GET ...?include=transcriptRows` — full on-disk rows (LLM + `kind: 'context'`). */
  transcriptRows?: unknown[];
}

export interface SessionListQuery {
  status?: 'active' | 'idle' | 'archived' | 'pinned';
  search?: string;
  /** Filter by `SessionMetadata.sourceChannel`, or comma-separated IM channels (e.g. `telegram,weixin`). */
  channel?: string;
  /** Filter by project id. */
  projectId?: string;
  /** Only sessions not attached to any project. */
  unassigned?: boolean;
  /** Only sessions updated after this epoch ms, unless an include rule keeps them visible. */
  updatedAfter?: number;
  includePinned?: boolean;
  includeSessionKey?: string;
  /** Filter by session origin types, sent as the gateway `types` query parameter. */
  sessionTypes?: string[];
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
