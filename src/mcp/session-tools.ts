import { z } from 'zod';

import { CapabilityError, defineReadCapability, type CapabilityContext, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';
import type { Config } from '../config/schema.js';
import { canShareConversationHistory, canSearchHistoryEntry } from '../session/history-recall-policy.js';
import { isPersonalConversation } from '../personal-agent/repository.js';
import {
  isRuntimeOnlyTranscriptMessage,
  isTranscriptCompactionEntry,
  isTranscriptCustomMessageEntry,
  type TranscriptStoredRow,
} from '../session/session-context-for-llm.js';
import { buildFts5SearchQuery, escapeSqlLike, sessionHanSearchTerms } from '../storage/sqlite/fts.js';
import { getSessionMetadata } from '../storage/sqlite/session-read-repository.js';
import { listSessionMetadata } from '../storage/sqlite/session-repository.js';
import { loadTranscriptRowsForSession } from '../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

const MAX_MESSAGE_TEXT_CHARS = 4_000;
const MAX_SNIPPET_CHARS = 320;

const sessionSummarySchema = z.object({
  conversationId: z.string(),
  name: z.string().optional(),
  agentId: z.string(),
  projectId: z.string().optional(),
  channel: z.string().optional(),
  messageCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  snippet: z.string().optional(),
});

export const McpSessionListOutput = z.object({
  items: z.array(sessionSummarySchema),
  total: z.number(),
  hasMore: z.boolean(),
});

export const McpSessionSearchOutput = z.object({
  query: z.string(),
  items: z.array(sessionSummarySchema),
});

export const McpSessionReadOutput = z.object({
  conversationId: z.string(),
  name: z.string().optional(),
  agentId: z.string(),
  projectId: z.string().optional(),
  totalMessages: z.number(),
  hasMore: z.boolean(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'tool']),
    text: z.string(),
    toolName: z.string().optional(),
    timestamp: z.number().optional(),
  })),
});

export const mcpSessionTools = {
  'xopc.sessions.list': { scope: 'workspace.read' as const, output: McpSessionListOutput },
  'xopc.sessions.search': { scope: 'workspace.read' as const, output: McpSessionSearchOutput },
  'xopc.sessions.read': { scope: 'workspace.read' as const, output: McpSessionReadOutput },
} as const;

function isSessionSafeForExternalMcp(
  cfg: Config,
  session: NonNullable<ReturnType<typeof getSessionMetadata>>,
  context: CapabilityContext,
): boolean {
  if (context.mcpProjectIds?.length && (!session.projectId || !context.mcpProjectIds.includes(session.projectId))) return false;
  return !session.hiddenFromSessionList && !isPersonalConversation(session.key)
    && canShareConversationHistory(cfg, session.key, context.conversationId);
}

function extractPlainTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const rec = part as { type?: unknown; text?: unknown; name?: unknown };
    if (rec.type === 'text' && typeof rec.text === 'string' && rec.text.trim()) {
      parts.push(rec.text.trim());
    } else if (rec.type === 'toolCall' && typeof rec.name === 'string') {
      parts.push(`[tool: ${rec.name}]`);
    }
  }
  return parts.join('\n').trim();
}

function readBestFtsSnippet(conversationId: string, rawQuery: string, sourceConversationId?: string): string | undefined {
  const hanTerms = sessionHanSearchTerms(rawQuery);
  const query = buildFts5SearchQuery(rawQuery);
  const rows = getSqliteDatabase().prepare(`
    SELECT f.entry_id AS entryId, f.content
    FROM transcript_fts f JOIN transcript_entries e ON e.entry_id = f.entry_id
    JOIN sessions s ON s.active_transcript_id = e.transcript_id AND s.conversation_id = f.conversation_id
    WHERE f.conversation_id = ? AND e.role IN ('user','assistant')
      AND COALESCE(json_extract(e.payload_json, '$.metadata.hiddenFromClient'), 0) = 0
      AND (f.entry_id IN (SELECT entry_id FROM transcript_fts WHERE transcript_fts MATCH ? AND conversation_id = ?)
        ${hanTerms.map(() => "OR f.content LIKE ? ESCAPE '\\'").join(' ')})
    ORDER BY e.seq ASC LIMIT 50
  `).all(conversationId, query, conversationId, ...hanTerms.map(term => `%${escapeSqlLike(term)}%`)) as Array<{ entryId: string; content: string }>;
  const row = rows.find(item => canSearchHistoryEntry({ conversationId: sourceConversationId }, conversationId, item.entryId, item.content));
  return row?.content.replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_CHARS) || undefined;
}

function toSummary(
  meta: ReturnType<typeof listSessionMetadata>['items'][number],
  snippet?: string,
) {
  return {
    conversationId: meta.key,
    ...(meta.name?.trim() ? { name: meta.name.trim() } : {}),
    agentId: meta.agentId,
    ...(meta.projectId ? { projectId: meta.projectId } : {}),
    ...(meta.sourceChannel ? { channel: meta.sourceChannel } : {}),
    messageCount: meta.messageCount ?? 0,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    ...(snippet ? { snippet } : {}),
  };
}

function visibleTranscriptMessages(
  rows: ReadonlyArray<TranscriptStoredRow>,
  includeToolCalls: boolean,
): Array<{ role: 'user' | 'assistant' | 'tool'; text: string; toolName?: string; timestamp?: number }> {
  const out: Array<{ role: 'user' | 'assistant' | 'tool'; text: string; toolName?: string; timestamp?: number }> = [];
  for (const row of rows) {
    if (isTranscriptCompactionEntry(row) || isRuntimeOnlyTranscriptMessage(row)) continue;
    if (isTranscriptCustomMessageEntry(row)) {
      if (row.display === false) continue;
      const text = extractPlainTextFromContent(row.content);
      if (text) {
        out.push({
          role: 'user',
          text: text.slice(0, MAX_MESSAGE_TEXT_CHARS),
          ...(typeof row.timestamp === 'number' ? { timestamp: row.timestamp } : {}),
        });
      }
      continue;
    }
    const rec = row as {
      role?: unknown;
      content?: unknown;
      toolName?: unknown;
      timestamp?: unknown;
      metadata?: { hiddenFromClient?: boolean };
    };
    if (rec.metadata?.hiddenFromClient === true) continue;
    if (rec.role === 'user' || rec.role === 'assistant') {
      const text = extractPlainTextFromContent(rec.content);
      if (!text) continue;
      out.push({
        role: rec.role,
        text: text.slice(0, MAX_MESSAGE_TEXT_CHARS),
        ...(typeof rec.timestamp === 'number' ? { timestamp: rec.timestamp } : {}),
      });
    } else if (includeToolCalls && rec.role === 'toolResult') {
      const text = extractPlainTextFromContent(rec.content);
      if (!text) continue;
      out.push({
        role: 'tool',
        text: text.slice(0, MAX_MESSAGE_TEXT_CHARS),
        ...(typeof rec.toolName === 'string' && rec.toolName ? { toolName: rec.toolName } : {}),
        ...(typeof rec.timestamp === 'number' ? { timestamp: rec.timestamp } : {}),
      });
    }
  }
  return out;
}

export function registerSessionTools(dispatcher: CapabilityDispatcher, getConfig: () => Config): void {
  const policy = {
    majorVersion: 1,
    effect: 'read' as const,
    surfaces: ['mcp'] as const,
    scopes: ['workspace.read'] as const,
  };

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.sessions.list',
    description: 'List recent chat sessions in xopc, optionally filtered by projectId or agentId.',
    input: z.strictObject({
      projectId: z.string().trim().min(1).max(200).optional(),
      agentId: z.string().trim().min(1).max(100).optional(),
      channel: z.string().trim().min(1).max(64).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).max(500).default(0),
    }),
    output: McpSessionListOutput,
    execute({ projectId, agentId, channel, limit, offset }, context) {
      context.assertCurrent?.();
      const cfg = getConfig();
      const items: ReturnType<typeof toSummary>[] = [];
      let total = 0;
      for (let cursor = 0; ; cursor += 100) {
        const page = listSessionMetadata({
          projectId, agentId, channel, excludeArchived: true, sortBy: 'updatedAt', sortOrder: 'desc',
          limit: 100, offset: cursor,
        });
        for (const item of page.items) {
          if (!isSessionSafeForExternalMcp(cfg, item, context)) continue;
          if (total >= offset && items.length < limit) items.push(toSummary(item));
          total++;
        }
        if (!page.hasMore) break;
      }
      return { items, total, hasMore: offset + items.length < total };
    },
  }));

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.sessions.search',
    description: 'Full-text search across past xopc chat sessions (titles and transcripts) using SQLite FTS5.',
    input: z.strictObject({
      query: z.string().trim().min(1).max(500),
      projectId: z.string().trim().min(1).max(200).optional(),
      agentId: z.string().trim().min(1).max(100).optional(),
      limit: z.number().int().min(1).max(30).default(10),
    }),
    output: McpSessionSearchOutput,
    execute({ query, projectId, agentId, limit }, context) {
      context.assertCurrent?.();
      const cfg = getConfig();
      const items: ReturnType<typeof toSummary>[] = [];
      for (let cursor = 0; items.length < limit; cursor += 100) {
        const page = listSessionMetadata({
          search: query, projectId, agentId, excludeArchived: true, sortBy: 'updatedAt', sortOrder: 'desc',
          limit: 100, offset: cursor,
        });
        for (const item of page.items) {
          if (!isSessionSafeForExternalMcp(cfg, item, context)) continue;
          const snippet = readBestFtsSnippet(item.key, query, context.conversationId);
          if (snippet || item.name?.toLowerCase().includes(query.toLowerCase())) items.push(toSummary(item, snippet));
          if (items.length === limit) break;
        }
        if (!page.hasMore) break;
      }
      return { query, items };
    },
  }));

  dispatcher.register(defineReadCapability({
    ...policy,
    id: 'xopc.sessions.read',
    description: 'Read visible user and assistant messages from a specific xopc session transcript.',
    input: z.strictObject({
      conversationId: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(100).default(40),
      offset: z.number().int().min(0).max(5000).default(0),
      includeToolCalls: z.boolean().default(false),
    }),
    output: McpSessionReadOutput,
    execute({ conversationId, limit, offset, includeToolCalls }, context) {
      context.assertCurrent?.();
      const meta = getSessionMetadata(conversationId);
      if (!meta || !isSessionSafeForExternalMcp(getConfig(), meta, context)) {
        throw new CapabilityError('NOT_FOUND', `Session not found: ${conversationId}`);
      }
      const rows = loadTranscriptRowsForSession(conversationId);
      const allMessages = visibleTranscriptMessages(rows, includeToolCalls)
        .filter(item => canSearchHistoryEntry({ conversationId: context.conversationId }, conversationId, null, item.text));
      const slice = allMessages.slice(offset, offset + limit);
      return {
        conversationId: meta.key,
        ...(meta.name?.trim() ? { name: meta.name.trim() } : {}),
        agentId: meta.agentId,
        ...(meta.projectId ? { projectId: meta.projectId } : {}),
        totalMessages: allMessages.length,
        hasMore: offset + slice.length < allMessages.length,
        messages: slice,
      };
    },
  }));
}
