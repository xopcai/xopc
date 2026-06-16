// Session management types

import type { TranscriptStoredRow } from './session-context-for-llm.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'toolResult';
  /** Plain string or structured content blocks (tool calls, multimodal). */
  content: string | unknown[];
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
  tool_call_id$?: string;
  toolName?: string;
  isError?: boolean;
  name?: string;
  /** Token usage from the LLM response (assistant messages only). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  /** Inbound attachment metadata (no base64). */
  media?: Array<{
    id: string;
    bucket: string;
    type: string;
    mimeType: string;
    name: string;
    size: number;
    uri: string;
    path: string;
  }>;
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
  lastFlushedAt?: string;
  flushCount?: number;
  sourceChannel: string;
  sourceChatId: string;
  customData?: Record<string, unknown>;
  /** Routing metadata */
  routing?: SessionRoutingMeta;
  /** Session statistics */
  stats?: SessionStats;
  /**
   * High-level origin for filtering/UI (e.g. `cron`, `heartbeat`, `webchat`).
   * Distinct from `sourceChannel` (routing namespace).
   */
  sessionType?: string;
  /**
   * Stable transcript document id (wrapped on-disk format), aligned with OpenClaw `sessionId`.
   */
  transcriptId?: string;
  /** First activity time for this session row (ISO), from transcript header when available. */
  sessionStartedAt?: string;
  /** Last transcript write / interaction (ISO), updated on each persist. */
  lastInteractionAt?: string;
  /**
   * Epoch ms when the last webchat run was aborted (`POST /api/agent/abort`).
   * Used with `clientCreatedAtMs` on the next POST /api/agent to drop stale queued sends.
   */
  abortCutoffTimestamp?: number;
}

/** Summary of wrapped transcript (no duplicate message bodies). */
export interface SessionTranscriptSummary {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  compactionCount: number;
}

/** Session detail (metadata + messages) */
export interface SessionDetail extends SessionMetadata {
  messages: Message[];
  /** Present when loaded with `includeTranscriptSummary` (gateway `?include=transcript`). */
  transcriptSummary?: SessionTranscriptSummary;
  /** Present when loaded with `include=transcriptRows` (full on-disk rows, LLM + `kind: 'context'`). */
  transcriptRows?: TranscriptStoredRow[];
}

/** Session list query parameters */
export interface SessionListQuery {
  status?: SessionStatus | SessionStatus[];
  /** Single `sourceChannel`, or comma-separated list (e.g. `telegram,weixin`). */
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
  /** Full on-disk rows (LLM + `kind: 'context'`) for audit / round-trip. */
  transcriptRows: TranscriptStoredRow[];
}

/** On-disk pre-compaction snapshot (OpenClaw-style checkpoint list). */
export interface CompactionCheckpointSummary {
  id: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface CompactionCheckpointDetail extends CompactionCheckpointSummary {
  messageCount: number;
}
