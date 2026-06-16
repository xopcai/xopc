import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { SessionAgentConfig } from '../../session/config-types.js';
import {
  isTranscriptContextEntry,
  type TranscriptStoredRow,
  type XopcTranscriptContextEntry,
} from '../../session/session-context-for-llm.js';
import { SessionStatus, type GlobalSessionStats, type SessionMetadata } from '../../session/types.js';
import {
  buildDefaultSessionMetadata,
  parseSessionKeySource,
  resolveAgentIdFromSessionKey,
} from './session-metadata.js';

export type SessionRow = {
  session_key: string;
  agent_id: string;
  current_transcript_id: string;
  status: string;
  name: string | null;
  tags_json: string;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  session_started_at: number | null;
  last_interaction_at: number | null;
  source_channel: string;
  source_chat_id: string;
  session_type: string | null;
  routing_json: string | null;
  custom_data_json: string | null;
  abort_cutoff_timestamp: number | null;
  message_count: number;
  estimated_tokens: number;
  compacted_count: number;
  last_flushed_at: string | null;
  flush_count: number;
  thinking_level: string | null;
  verbose_level: string | null;
};

export type TranscriptEntryRow = {
  entry_id: string;
  transcript_id: string;
  seq: number;
  entry_kind: string;
  role: string | null;
  payload_json: string;
  created_at: number;
};

export type SessionConfigRow = {
  session_key: string;
  thinking_level: string | null;
  reasoning_level: string | null;
  verbose_level: string | null;
  elevated_mode: string | null;
  model_override: string | null;
  provider_override: string | null;
  working_directory_override: string | null;
  updated_at: number;
};

function parseJson<T>(raw: string | null | undefined): T | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function isoFromMs(ms: number | null | undefined): string | undefined {
  if (ms == null || !Number.isFinite(ms)) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

export function sessionRowToMetadata(sessionKey: string, row: SessionRow): SessionMetadata {
  const defaults = buildDefaultSessionMetadata(sessionKey);
  const { channel: keySource, chatId: keyChatId } = parseSessionKeySource(sessionKey);
  const routing = parseJson<SessionMetadata['routing']>(row.routing_json) ?? defaults.routing;
  const customData = parseJson<Record<string, unknown>>(row.custom_data_json) ?? defaults.customData;
  const tags = parseJson<string[]>(row.tags_json) ?? [];
  const createdAt = isoFromMs(row.created_at) ?? defaults.createdAt;
  const updatedAt = isoFromMs(row.updated_at) ?? defaults.updatedAt;
  const lastAccessedAt = isoFromMs(row.last_accessed_at) ?? defaults.lastAccessedAt;
  const diskSc = row.source_channel?.trim() ?? '';
  const diskChat = row.source_chat_id?.trim() ?? '';

  return {
    ...defaults,
    key: sessionKey,
    status: row.status as SessionStatus,
    name: row.name ?? undefined,
    tags,
    createdAt,
    updatedAt,
    lastAccessedAt,
    sessionStartedAt: isoFromMs(row.session_started_at),
    lastInteractionAt: isoFromMs(row.last_interaction_at),
    sourceChannel: diskSc || keySource,
    sourceChatId: diskChat || keyChatId,
    sessionType: row.session_type ?? defaults.sessionType,
    routing,
    customData,
    abortCutoffTimestamp: row.abort_cutoff_timestamp ?? undefined,
    messageCount: row.message_count,
    estimatedTokens: row.estimated_tokens,
    compactedCount: row.compacted_count,
    lastFlushedAt: row.last_flushed_at ?? undefined,
    flushCount: row.flush_count,
    transcriptId: row.current_transcript_id,
    stats: {
      messageCount: row.message_count,
      tokenCount: row.estimated_tokens,
      lastTurnAt: row.last_interaction_at ?? undefined,
    },
  };
}

export function metadataToSessionInsert(
  sessionKey: string,
  transcriptId: string,
  metadata: SessionMetadata,
  thinkingLevel?: string | null,
  verboseLevel?: string | null,
): {
  sessionKey: string;
  agentId: string;
  transcriptId: string;
  status: string;
  name: string | null;
  tagsJson: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  sessionStartedAt: number | null;
  lastInteractionAt: number | null;
  sourceChannel: string;
  sourceChatId: string;
  sessionType: string | null;
  routingJson: string | null;
  customDataJson: string | null;
  abortCutoffTimestamp: number | null;
  messageCount: number;
  estimatedTokens: number;
  compactedCount: number;
  lastFlushedAt: string | null;
  flushCount: number;
  thinkingLevel: string | null;
  verboseLevel: string | null;
} {
  const now = Date.now();
  return {
    sessionKey,
    agentId: resolveAgentIdFromSessionKey(sessionKey),
    transcriptId,
    status: metadata.status,
    name: metadata.name ?? null,
    tagsJson: JSON.stringify(metadata.tags ?? []),
    createdAt: Date.parse(metadata.createdAt) || now,
    updatedAt: Date.parse(metadata.updatedAt) || now,
    lastAccessedAt: Date.parse(metadata.lastAccessedAt) || now,
    sessionStartedAt: metadata.sessionStartedAt ? Date.parse(metadata.sessionStartedAt) : now,
    lastInteractionAt: metadata.lastInteractionAt ? Date.parse(metadata.lastInteractionAt) : null,
    sourceChannel: metadata.sourceChannel,
    sourceChatId: metadata.sourceChatId,
    sessionType: metadata.sessionType ?? null,
    routingJson: metadata.routing ? JSON.stringify(metadata.routing) : null,
    customDataJson: metadata.customData ? JSON.stringify(metadata.customData) : null,
    abortCutoffTimestamp: metadata.abortCutoffTimestamp ?? null,
    messageCount: metadata.messageCount,
    estimatedTokens: metadata.estimatedTokens,
    compactedCount: metadata.compactedCount,
    lastFlushedAt: metadata.lastFlushedAt ?? null,
    flushCount: metadata.flushCount ?? 0,
    thinkingLevel: thinkingLevel ?? null,
    verboseLevel: verboseLevel ?? null,
  };
}

export function sessionConfigRowToConfig(row: SessionConfigRow): SessionAgentConfig {
  return {
    ...(row.thinking_level ? { thinkingLevel: row.thinking_level as SessionAgentConfig['thinkingLevel'] } : {}),
    ...(row.reasoning_level ? { reasoningLevel: row.reasoning_level as SessionAgentConfig['reasoningLevel'] } : {}),
    ...(row.verbose_level ? { verboseLevel: row.verbose_level as SessionAgentConfig['verboseLevel'] } : {}),
    ...(row.elevated_mode ? { elevatedMode: row.elevated_mode as SessionAgentConfig['elevatedMode'] } : {}),
    ...(row.model_override ? { modelOverride: row.model_override } : {}),
    ...(row.provider_override ? { providerOverride: row.provider_override } : {}),
    ...(row.working_directory_override ? { workingDirectoryOverride: row.working_directory_override } : {}),
    updatedAt: row.updated_at,
  };
}

export function transcriptEntryRowToStoredRow(row: TranscriptEntryRow): TranscriptStoredRow {
  const payload = JSON.parse(row.payload_json) as TranscriptStoredRow;
  return payload;
}

export function classifyStoredRow(row: TranscriptStoredRow): {
  entryKind: 'message' | 'context' | 'compaction';
  role: string | null;
} {
  if (isTranscriptContextEntry(row)) {
    return { entryKind: 'context', role: null };
  }
  const record = row as AgentMessage & { type?: string };
  if (record.type === 'compaction' || (row as { kind?: string }).kind === 'compaction') {
    return { entryKind: 'compaction', role: null };
  }
  return { entryKind: 'message', role: record.role ?? null };
}

export function extractFtsContent(row: TranscriptStoredRow): string {
  if (isTranscriptContextEntry(row)) {
    const ctx = row as XopcTranscriptContextEntry;
    return [ctx.text, ctx.id].filter(Boolean).join(' ');
  }
  const msg = row as AgentMessage;
  return extractTextFromMessageContent((msg as { content?: unknown }).content);
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const type = (block as { type?: string }).type;
    if (type === 'text' && typeof (block as { text?: string }).text === 'string') {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join('\n');
}

export function estimateTokensFromMessages(messages: AgentMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    const content = (msg as { content?: unknown }).content;
    const text = extractTextFromMessageContent(content);
    total += Math.ceil(text.length / 4);
  }
  return total;
}

export function buildGlobalSessionStats(sessions: SessionMetadata[]): GlobalSessionStats {
  const byChannel: Record<string, number> = {};
  for (const session of sessions) {
    byChannel[session.sourceChannel] = (byChannel[session.sourceChannel] || 0) + 1;
  }
  let oldestSession: string | undefined;
  let newestSession: string | undefined;
  if (sessions.length > 0) {
    const sorted = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    oldestSession = sorted[0]!.createdAt;
    newestSession = sorted[sorted.length - 1]!.createdAt;
  }
  return {
    totalSessions: sessions.length,
    activeSessions: sessions.filter(
      (s) => s.status === SessionStatus.ACTIVE || s.status === SessionStatus.IDLE,
    ).length,
    archivedSessions: sessions.filter((s) => s.status === SessionStatus.ARCHIVED).length,
    pinnedSessions: sessions.filter((s) => s.status === SessionStatus.PINNED).length,
    totalMessages: sessions.reduce((sum, s) => sum + s.messageCount, 0),
    totalTokens: sessions.reduce((sum, s) => sum + s.estimatedTokens, 0),
    oldestSession,
    newestSession,
    byChannel,
  };
}
