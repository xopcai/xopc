// Cross-session transcript discovery, reading, keyword search, and optional LLM summaries
import { Type } from '@sinclair/typebox';
import type { AgentMessage, AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { type Api, type Model, type UserMessage } from '@earendil-works/pi-ai/compat';

import { resolveModel } from '../../providers/index.js';
import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import type { SessionStore } from '../../session/store.js';
import type { SessionTranscriptRecallMatch } from '../../storage/sqlite/index.js';
import { createLogger } from '../../utils/logger.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';
import { projectUnadmittedForgottenFields, forgottenHistoryEntries, FORGOTTEN_HISTORY_EXCERPT } from '../../memory-learning/forgotten-history.js';
import type { CaptureScopeContext } from '../../user-model/capture/executor.js';
import { stripRuntimeContextFromUserMessage } from '../../session/user-message-display.js';
import { sessionSearchTerms } from '../../storage/sqlite/fts.js';
import { LOCAL_READ_MAX_CHARS } from './local-read-budget.js';

const log = createLogger('Agent:SessionSearch');

const MAX_SUMMARY_CHARS = 20_000;
const FULL_READ_MAX_CHARS = 24_000;
const DEFAULT_SUMMARY_PROMPT = 'Summarize the key topics, work completed, decisions, and outcomes in this conversation.';

function resolveSummaryModel(deps: SessionSearchToolDeps): Model<Api> {
  const envRef = process.env.XOPC_SESSION_SEARCH_MODEL?.trim();
  if (envRef) {
    return resolveModel(envRef);
  }

  return deps.getPrimaryModel();
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item !== 'object' || item === null || !('type' in item)) {
      continue;
    }
    const c = item as { type?: string; text?: string };
    if (c.type === 'text' && typeof c.text === 'string') {
      parts.push(c.text);
    }
  }
  return parts.join(' ');
}

function formatMessagesForSummary(messages: AgentMessage[]): string {
  const lines: string[] = [];
  let total = 0;
  for (const msg of messages) {
    const role = String(msg.role || 'unknown').toUpperCase();
    const text = extractTextFromContent(readAgentMessageContent(msg));
    const line = `${role}: ${text}`;
    if (total + line.length > MAX_SUMMARY_CHARS) {
      lines.push('… [truncated]');
      break;
    }
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n\n');
}

function parseTimeBound(value: string | number | undefined, edge: 'start' | 'end'): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return Number.NaN;
    return value < 1_000_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 0) return Number.NaN;
    return num < 1_000_000_000_000 ? Math.trunc(num * 1000) : Math.trunc(num);
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = edge === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return Number.NaN;
    }
    return date.getTime();
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function summarizeSession(
  messages: AgentMessage[],
  query: string,
  deps: SessionSearchToolDeps,
  signal: AbortSignal | undefined,
  logMeta?: { summarizingConversationId: string },
): Promise<string> {
  if (messages.length === 0) {
    return 'No messages in session.';
  }

  const formatted = formatMessagesForSummary(messages);
  const prompt = `Summarize this conversation for someone asking: "${query}". Focus on facts, work completed, decisions, and names. Max 200 words. Use the same language as the conversation when possible.

Conversation:
${formatted}`;

  const userMsg: UserMessage = { role: 'user', content: prompt, timestamp: Date.now() };
  const model = resolveSummaryModel(deps);

  try {
    const result = await completeWithResolvedCredentials(
      model,
      { messages: [userMsg] },
      {
        maxTokens: 400,
        temperature: 0.15,
        signal: signal as AbortSignal,
      },
      undefined,
      { operation: 'tool.session_search_summarize' },
    );

    let text = '';
    if (Array.isArray(result.content)) {
      for (const c of result.content) {
        if (c && typeof c === 'object' && (c as { type?: string }).type === 'text') {
          text += String((c as { text?: string }).text || '');
        }
      }
    }
    return text.trim() || '[Empty summary]';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      {
        err,
        summarizingConversationId: logMeta?.summarizingConversationId,
        queryLength: query.length,
        messageCount: messages.length,
      },
      `session_search LLM summarization failed${logMeta?.summarizingConversationId ? ` (session ${logMeta.summarizingConversationId})` : ''}: ${msg}`,
    );
    return `[Summarization failed: ${msg}]`;
  }
}

const RoleFilterSchema = Type.Union([
  Type.Literal('user'),
  Type.Literal('assistant'),
  Type.Literal('system'),
  Type.Literal('tool'),
  Type.Literal('toolResult'),
]);

const TimeBoundSchema = Type.Union([Type.String(), Type.Number()]);

const SessionSearchSchema = Type.Object({
  query: Type.Optional(
    Type.String({ description: 'Keyword search over conversations (or inside conversationId). Omit to list recent sessions or read turns of conversationId.' }),
  ),
  conversationId: Type.Optional(
    Type.String({ description: 'Read or summarize a specific conversation by ID (discovered from listing sessions).' }),
  ),
  agentId: Type.Optional(
    Type.String({ description: 'Filter sessions to a specific agent ID.' }),
  ),
  projectId: Type.Optional(
    Type.String({ description: 'Filter sessions to a specific project ID.' }),
  ),
  since: Type.Optional(
    TimeBoundSchema,
  ),
  until: Type.Optional(
    TimeBoundSchema,
  ),
  roleFilter: Type.Optional(RoleFilterSchema),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 60 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Message offset (0-based) when reading a specific conversationId.' })),
  summarize: Type.Optional(
    Type.Boolean({ description: 'When true (non-localOnly agents), return LLM summaries for conversationId or sessions matched by since/until.' }),
  ),
  excludeConversationId: Type.Optional(
    Type.String({ description: 'Exclude this session key from multi-session results (keyword search defaults to excluding current chat).' }),
  ),
});

export interface SessionSearchToolDeps {
  getSessionStore: () => SessionStore;
  getPrimaryModel: () => Model<Api>;
  getCurrentConversationId?: () => string | undefined;
  canAccess?: () => boolean;
  canRecallConversation?: (conversationId: string) => boolean;
  canRecallEntry?: (conversationId: string, entryId: string, content: string) => boolean;
  localOnly?: boolean;
  includePersonalAgent?: boolean;
  historyScope?: string;
  getHistoryContext?: () => CaptureScopeContext;
  getCurrentUserText?: () => string | undefined;
}

type SessionSearchParams = {
  query?: string;
  conversationId?: string;
  agentId?: string;
  projectId?: string;
  since?: string | number;
  until?: string | number;
  roleFilter?: 'user' | 'assistant' | 'system' | 'tool' | 'toolResult';
  limit?: number;
  offset?: number;
  summarize?: boolean;
  excludeConversationId?: string;
};

type LoadedEntry = {
  entryId: string;
  seq: number;
  role: string;
  createdAt: number;
  content: string;
};

async function loadReadableEntries(
  store: SessionStore,
  conversationId: string,
  options: {
    roleFilter?: SessionSearchParams['roleFilter'];
    since?: number;
    until?: number;
    offset: number;
    limit: number;
  },
): Promise<{ entries: LoadedEntry[]; total: number; hasMore: boolean }> {
  if (typeof store.readSessionEntries === 'function') {
    const page = store.readSessionEntries(conversationId, {
      roles: options.roleFilter ? [options.roleFilter] : ['user', 'assistant'],
      ...(options.since !== undefined ? { since: options.since } : {}),
      ...(options.until !== undefined ? { until: options.until } : {}),
      offset: options.offset,
      limit: options.limit,
      order: 'asc',
    });
    return {
      entries: page.entries.map((entry: SessionTranscriptRecallMatch) => ({
        entryId: entry.entryId,
        seq: entry.seq,
        role: entry.role ?? 'unknown',
        createdAt: entry.createdAt,
        content: entry.content,
      })),
      total: page.total,
      hasMore: page.hasMore,
    };
  }

  const rawMessages = await store.load(conversationId);
  const allowedRoles = options.roleFilter ? new Set([options.roleFilter]) : new Set(['user', 'assistant']);
  const entries: LoadedEntry[] = [];
  for (let idx = 0; idx < rawMessages.length; idx++) {
    const msg = rawMessages[idx];
    const role = String(msg.role || 'unknown');
    if (!allowedRoles.has(role)) continue;
    const createdAt = typeof (msg as { timestamp?: unknown }).timestamp === 'number'
      ? (msg as { timestamp: number }).timestamp
      : 0;
    if (options.since !== undefined && createdAt > 0 && createdAt < options.since) continue;
    if (options.until !== undefined && createdAt > 0 && createdAt > options.until) continue;
    const text = extractTextFromContent(readAgentMessageContent(msg)).trim();
    if (!text) continue;
    entries.push({
      entryId: `msg-${idx + 1}`,
      seq: idx + 1,
      role,
      createdAt,
      content: text,
    });
  }
  const page = entries.slice(options.offset, options.offset + options.limit);
  return {
    entries: page,
    total: entries.length,
    hasMore: options.offset + page.length < entries.length,
  };
}

export function createSessionSearchTool(deps: SessionSearchToolDeps): AgentTool {
  return {
    name: 'session_search',
    label: 'Session search',
    description: deps.localOnly
      ? 'List, search, or read owner chats across agents, projects, and workspaces. Omit query to list recent chats (filterable by since/until/agentId/projectId); pass query for short matching excerpts; pass conversationId to read bounded turns from a specific chat. No model or network calls.'
      : 'List, search, read, or summarize owner chats across agents, projects, and workspaces. Omit query to list recent sessions (filterable by since/until/agentId/projectId, or set summarize=true to summarize matched sessions); pass query for keyword search with summaries; pass conversationId to read turns or summarize a specific chat. For citable Task evidence, read original turns with conversationId and summarize=false.',
    parameters: deps.localOnly
      ? Type.Object({
          ...SessionSearchSchema.properties,
          query: Type.Optional(Type.String({ maxLength: 500, description: 'Keywords for other chats; omit to list recent chats or read conversationId.' })),
        })
      : SessionSearchSchema,
    supportsParallel: true,
    idempotent: true,

    async execute(
      _toolCallId: string,
      params: any,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      if (deps.canAccess && !deps.canAccess()) {
        return {
          content: [{ type: 'text', text: 'Cross-session history is disabled for this session.' }],
          details: { error: 'cross_session_history_disabled' },
        };
      }
      const p = params as SessionSearchParams;
      const query = p.query?.trim() ?? '';
      const targetConversationId = p.conversationId?.trim() ?? '';
      const filterAgentId = p.agentId?.trim() || undefined;
      const filterProjectId = p.projectId?.trim() || undefined;
      const sinceMs = parseTimeBound(p.since, 'start');
      const untilMs = parseTimeBound(p.until, 'end');

      if (Number.isNaN(sinceMs) || Number.isNaN(untilMs) || (sinceMs !== undefined && untilMs !== undefined && sinceMs > untilMs)) {
        return {
          content: [{ type: 'text', text: 'Invalid since/until time range. Use ISO dates (e.g. "2026-11-17") or epoch timestamps with since <= until.' }],
          details: { error: 'invalid_time_range' },
        };
      }
      if (deps.localOnly && query.length > 500) {
        return {
          content: [{ type: 'text', text: 'Use at most 500 characters of search keywords.' }],
          details: { error: 'invalid_query' },
        };
      }

      const store = deps.getSessionStore();
      const historyScope = deps.canRecallConversation ? (deps.historyScope ?? 'owner_cross_session') : undefined;

      try {
        const protectedEntries = deps.getHistoryContext
          ? forgottenHistoryEntries(deps.getHistoryContext(), deps.getCurrentUserText?.())
          : new Set<string>();
        const projectTitle = (key: string, name: string | undefined) => {
          if (name === undefined) return name;
          const projected = [...protectedEntries].some(entry => entry.startsWith(`${key}:`))
            ? FORGOTTEN_HISTORY_EXCERPT
            : deps.getHistoryContext
              ? projectUnadmittedForgottenFields(name, deps.getHistoryContext(), deps.getCurrentUserText?.())
              : name;
          return deps.localOnly ? projected.slice(0, 200) : projected;
        };
        const projectEntryContent = (key: string, entryId: string, rawContent: string) => {
          const masked = (protectedEntries.has(`${key}:*`) || protectedEntries.has(`${key}:${entryId}`))
            ? FORGOTTEN_HISTORY_EXCERPT
            : deps.getHistoryContext
              ? projectUnadmittedForgottenFields(rawContent, deps.getHistoryContext(), deps.getCurrentUserText?.())
              : rawContent;
          return stripRuntimeContextFromUserMessage(masked);
        };

        // Mode A: Read, search within, or summarize a specific conversation by ID.
        if (targetConversationId) {
          if (deps.canRecallConversation && !deps.canRecallConversation(targetConversationId)) {
            return {
              content: [{ type: 'text', text: 'This session is not accessible.' }],
              details: { error: 'session_access_denied', conversationId: targetConversationId },
            };
          }
          const meta = typeof store.getMetadata === 'function' ? await store.getMetadata(targetConversationId) : null;
          const metaSummary = {
            conversationId: targetConversationId,
            ...(meta?.name !== undefined ? { name: projectTitle(targetConversationId, meta.name) } : {}),
            ...(meta?.agentId ? { agentId: meta.agentId } : {}),
            ...(meta?.projectId ? { projectId: meta.projectId } : {}),
            ...(meta?.updatedAt ? { updatedAt: meta.updatedAt } : {}),
            ...(meta?.messageCount !== undefined ? { messageCount: meta.messageCount } : {}),
            ...(meta?.sourceChannel ? { sourceChannel: meta.sourceChannel } : {}),
          };

          if (p.summarize && !deps.localOnly) {
            if ([...protectedEntries].some(entry => entry.startsWith(`${targetConversationId}:`))) {
              const payload = { success: true, mode: 'summary', ...metaSummary, summary: FORGOTTEN_HISTORY_EXCERPT };
              return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], details: payload };
            }
            const loaded = await loadReadableEntries(store, targetConversationId, {
              roleFilter: p.roleFilter,
              since: sinceMs,
              until: untilMs,
              offset: 0,
              limit: 200,
            });
            const allowedMessages: AgentMessage[] = loaded.entries
              .filter(entry => !deps.canRecallEntry || deps.canRecallEntry(targetConversationId, entry.entryId, entry.content))
              .map(entry => ({
                role: entry.role as 'user',
                content: projectEntryContent(targetConversationId, entry.entryId, entry.content),
                timestamp: entry.createdAt,
              }));
            const summary = await summarizeSession(
              allowedMessages,
              query || DEFAULT_SUMMARY_PROMPT,
              deps,
              signal,
              { summarizingConversationId: targetConversationId },
            );
            const payload = {
              success: true,
              mode: 'summary',
              ...metaSummary,
              messageCountInRange: allowedMessages.length,
              summary,
            };
            return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], details: payload };
          }

          const charBudget = deps.localOnly ? LOCAL_READ_MAX_CHARS : FULL_READ_MAX_CHARS;
          const perMessageMaxChars = deps.localOnly ? 1200 : 3000;

          if (query && typeof store.recallSession === 'function') {
            const matchLimit = Math.min(deps.localOnly ? 8 : 20, Math.max(1, p.limit ?? (deps.localOnly ? 5 : 10)));
            const excerpts = store.recallSession(targetConversationId, query, { limit: matchLimit, matchMode: 'keyword' })
              .filter(match => (!p.roleFilter || match.role === p.roleFilter)
                && (sinceMs === undefined || match.createdAt >= sinceMs)
                && (untilMs === undefined || match.createdAt <= untilMs)
                && (!deps.canRecallEntry || deps.canRecallEntry(targetConversationId, match.entryId, match.content)))
              .map(match => {
                const content = projectEntryContent(targetConversationId, match.entryId, match.content);
                const positions = sessionSearchTerms(query).map(term => content.toLowerCase().indexOf(term.toLowerCase())).filter(at => at >= 0);
                const at = positions.length ? Math.min(...positions) : 0;
                const start = Math.max(0, at - 200);
                return {
                  entryId: match.entryId,
                  seq: match.seq,
                  role: match.role,
                  createdAt: match.createdAt,
                  content: content.slice(start, start + perMessageMaxChars),
                  truncated: start > 0 || content.length > start + perMessageMaxChars,
                };
              });
            const payload = {
              success: true,
              mode: 'read_search',
              ...metaSummary,
              query,
              excerpts,
              truncated: excerpts.some(item => item.truncated),
              ...(historyScope ? { historyScope } : {}),
            };
            while (JSON.stringify(payload).length > charBudget && excerpts.length) {
              payload.truncated = true;
              if (excerpts.length > 1) excerpts.pop();
              else if (excerpts[0].content.length > 100) {
                excerpts[0].content = excerpts[0].content.slice(0, Math.floor(excerpts[0].content.length / 2));
                excerpts[0].truncated = true;
              } else break;
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(payload, null, deps.localOnly ? undefined : 2) }],
              details: { mode: 'read_search', conversationId: targetConversationId, count: excerpts.length },
            };
          }

          const offset = Math.max(0, p.offset ?? 0);
          const msgLimit = Math.min(deps.localOnly ? 15 : 60, Math.max(1, p.limit ?? (deps.localOnly ? 10 : 25)));
          const loaded = await loadReadableEntries(store, targetConversationId, {
            roleFilter: p.roleFilter,
            since: sinceMs,
            until: untilMs,
            offset,
            limit: msgLimit,
          });
          const messages = loaded.entries
            .filter(entry => !deps.canRecallEntry || deps.canRecallEntry(targetConversationId, entry.entryId, entry.content))
            .map(entry => {
              const content = projectEntryContent(targetConversationId, entry.entryId, entry.content);
              return {
                entryId: entry.entryId,
                seq: entry.seq,
                role: entry.role,
                createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
                content: content.slice(0, perMessageMaxChars),
                truncated: content.length > perMessageMaxChars,
              };
            });
          const payload: Record<string, unknown> = {
            success: true,
            mode: 'read',
            ...metaSummary,
            offset,
            totalMessages: loaded.total,
            hasMore: loaded.hasMore,
            ...(loaded.hasMore ? { nextOffset: offset + loaded.entries.length } : {}),
            messages,
            truncated: messages.some(item => item.truncated),
            ...(historyScope ? { historyScope } : {}),
          };
          while (JSON.stringify(payload).length > charBudget && messages.length) {
            payload.truncated = true;
            if (messages.length > 1) {
              messages.pop();
              payload.hasMore = true;
              payload.nextOffset = offset + messages.length;
            } else if (messages[0].content.length > 100) {
              messages[0].content = messages[0].content.slice(0, Math.floor(messages[0].content.length / 2));
              messages[0].truncated = true;
            } else break;
          }
          if (deps.localOnly && (payload.hasMore || payload.truncated)) {
            payload.requiresSpecialist = true;
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(payload, null, deps.localOnly ? undefined : 2) }],
            details: { mode: 'read', conversationId: targetConversationId, count: messages.length, hasMore: payload.hasMore },
          };
        }

        // Mode B: List recent sessions (optionally filtered by since/until/agentId/projectId, and optionally summarized when !localOnly).
        if (!query) {
          const listLimit = Math.min(deps.localOnly ? 10 : 20, Math.max(1, p.limit ?? (deps.localOnly ? 5 : 10)));
          const fetchLimit = Math.min(100, Math.max(listLimit * 4, listLimit + 20));
          const listed = await store.list({
            limit: fetchLimit,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
            includePersonalAgent: deps.includePersonalAgent ?? true,
            ...(filterAgentId ? { agentId: filterAgentId } : {}),
            ...(filterProjectId ? { projectId: filterProjectId } : {}),
            ...(sinceMs !== undefined ? { updatedAfter: sinceMs } : {}),
            ...(untilMs !== undefined ? { updatedBefore: untilMs } : {}),
          });
          const explicitExclude = p.excludeConversationId?.trim() || '';
          const filtered = listed.items
            .filter(item => (!deps.canRecallConversation || deps.canRecallConversation(item.key))
              && (!explicitExclude || item.key !== explicitExclude))
            .slice(0, listLimit);

          if (p.summarize && !deps.localOnly) {
            const summaries = await Promise.all(
              filtered.map(async (s) => {
                const itemBase = {
                  conversationId: s.key,
                  name: projectTitle(s.key, s.name),
                  agentId: s.agentId,
                  ...(s.projectId ? { projectId: s.projectId } : {}),
                  updatedAt: s.updatedAt,
                  messageCount: s.messageCount,
                  sourceChannel: s.sourceChannel,
                };
                if ([...protectedEntries].some(entry => entry.startsWith(`${s.key}:`))) {
                  return { ...itemBase, summary: FORGOTTEN_HISTORY_EXCERPT };
                }
                const loaded = await loadReadableEntries(store, s.key, {
                  roleFilter: p.roleFilter,
                  since: sinceMs,
                  until: untilMs,
                  offset: 0,
                  limit: 200,
                });
                const allowedMessages: AgentMessage[] = loaded.entries
                  .filter(entry => !deps.canRecallEntry || deps.canRecallEntry(s.key, entry.entryId, entry.content))
                  .map(entry => ({
                    role: entry.role as 'user',
                    content: projectEntryContent(s.key, entry.entryId, entry.content),
                    timestamp: entry.createdAt,
                  }));
                const summary = await summarizeSession(
                  allowedMessages,
                  DEFAULT_SUMMARY_PROMPT,
                  deps,
                  signal,
                  { summarizingConversationId: s.key },
                );
                return { ...itemBase, messageCountInRange: allowedMessages.length, summary };
              }),
            );
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    mode: 'timeframe_summary',
                    ...(sinceMs !== undefined ? { since: new Date(sinceMs).toISOString() } : {}),
                    ...(untilMs !== undefined ? { until: new Date(untilMs).toISOString() } : {}),
                    results: summaries,
                    count: summaries.length,
                    ...(historyScope ? { historyScope } : {}),
                  },
                  null,
                  2,
                ),
              }],
              details: { mode: 'timeframe_summary', count: summaries.length },
            };
          }

          const items = filtered.map((s) => ({
            key: s.key,
            name: projectTitle(s.key, s.name),
            agentId: s.agentId,
            ...(s.projectId ? { projectId: s.projectId } : {}),
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            messageCount: s.messageCount,
            sourceChannel: s.sourceChannel,
          }));
          const payload: Record<string, unknown> = {
            success: true,
            mode: 'recent',
            results: items,
            total: deps.canRecallConversation ? items.length : listed.total,
            ...(historyScope ? { historyScope } : {}),
          };
          if (deps.localOnly) {
            while (JSON.stringify(payload).length > LOCAL_READ_MAX_CHARS && items.length) {
              items.pop();
              payload.truncated = true;
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(payload, null, deps.localOnly ? undefined : 2),
              },
            ],
            details: { mode: 'recent', items },
          };
        }

        // Mode C: Keyword search across sessions.
        const limit = Math.min(deps.localOnly ? 5 : 15, Math.max(1, p.limit ?? (deps.localOnly ? 3 : 5)));
        const fetchLimit = Math.min(100, Math.max(limit * 4, limit + 20));
        const listed = await store.list({
          search: query,
          limit: fetchLimit,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
          includePersonalAgent: deps.includePersonalAgent ?? true,
          ...(filterAgentId ? { agentId: filterAgentId } : {}),
          ...(filterProjectId ? { projectId: filterProjectId } : {}),
          ...(sinceMs !== undefined ? { updatedAfter: sinceMs } : {}),
          ...(untilMs !== undefined ? { updatedBefore: untilMs } : {}),
        });
        let matches = listed.items
          .filter(item => !deps.canRecallConversation || deps.canRecallConversation(item.key))
          .map((item) => ({ key: item.key, item, score: 1 }));

        const exclude = p.excludeConversationId?.trim() || deps.getCurrentConversationId?.() || '';
        if (exclude) {
          matches = matches.filter((m) => m.key !== exclude);
        }

        const top = matches.slice(0, limit);
        if (deps.localOnly) {
          const results = top.map(({ key, item }) => ({
            conversationId: key,
            name: projectTitle(key, item.name),
            ...(item.agentId ? { agentId: item.agentId } : {}),
            ...(item.projectId ? { projectId: item.projectId } : {}),
            ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
            excerpts: store.recallSession(key, query, { limit: 2, matchMode: 'keyword' })
              .filter(match => (!p.roleFilter || match.role === p.roleFilter)
                && (sinceMs === undefined || match.createdAt >= sinceMs)
                && (untilMs === undefined || match.createdAt <= untilMs)
                && (!deps.canRecallEntry || deps.canRecallEntry(key, match.entryId, match.content)))
              .map(match => {
                const content = projectEntryContent(key, match.entryId, match.content);
                const positions = sessionSearchTerms(query).map(term => content.toLowerCase().indexOf(term.toLowerCase())).filter(at => at >= 0);
                const at = positions.length ? Math.min(...positions) : 0;
                const start = Math.max(0, at - 200);
                return {
                  entryId: match.entryId,
                  createdAt: match.createdAt,
                  seq: match.seq,
                  role: match.role,
                  content: content.slice(start, start + 800),
                  truncated: start > 0 || content.length > start + 800,
                };
              }),
          }));
          const payload = {
            success: true,
            mode: 'keyword',
            query,
            results,
            truncated: false,
            ...(historyScope ? { historyScope } : {}),
          };
          while (JSON.stringify(payload).length > LOCAL_READ_MAX_CHARS && results.length) {
            payload.truncated = true;
            if (results.length > 1) results.pop();
            else {
              const excerpts = results[0].excerpts;
              const longest = excerpts.toSorted((a, b) => b.content.length - a.content.length)[0];
              if (!longest || longest.content.length <= 100) break;
              longest.content = longest.content.slice(0, Math.floor(longest.content.length / 2));
              longest.truncated = true;
            }
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(payload) }],
            details: { localOnly: true, count: results.length },
          };
        }

        const summaries = await Promise.all(
          top.map(async ({ key, item, score }) => {
            const meta = {
              conversationId: key,
              ...(item.name !== undefined ? { name: projectTitle(key, item.name) } : {}),
              ...(item.agentId ? { agentId: item.agentId } : {}),
              ...(item.projectId ? { projectId: item.projectId } : {}),
              ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
              score,
            };
            if ([...protectedEntries].some(entry => entry.startsWith(`${key}:`))) {
              return { ...meta, summary: FORGOTTEN_HISTORY_EXCERPT };
            }
            if (deps.canRecallEntry) {
              const excerpts = store.recallSession(key, query, { limit: 8, matchMode: 'keyword' })
                .filter(match => (!p.roleFilter || match.role === p.roleFilter)
                  && (sinceMs === undefined || match.createdAt >= sinceMs)
                  && (untilMs === undefined || match.createdAt <= untilMs)
                  && deps.canRecallEntry!(key, match.entryId, match.content));
              const messages = excerpts.map(match => ({
                role: match.role as 'user',
                content: projectEntryContent(key, match.entryId, match.content),
                timestamp: match.createdAt,
              }));
              return {
                ...meta,
                summary: await summarizeSession(messages, query, deps, signal, { summarizingConversationId: key }),
              };
            }
            let messages = await store.load(key);
            if (deps.getHistoryContext) {
              messages = projectUnadmittedForgottenFields(messages, deps.getHistoryContext(), deps.getCurrentUserText?.());
            }

            if (p.roleFilter) {
              messages = messages.filter((m) => m.role === p.roleFilter);
            }

            const summary = await summarizeSession(messages, query, deps, signal, {
              summarizingConversationId: key,
            });
            return { ...meta, summary };
          }),
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  mode: 'keyword',
                  query,
                  results: summaries,
                  count: summaries.length,
                  ...(historyScope ? { historyScope } : {}),
                },
                null,
                2,
              ),
            },
          ],
          details: { query, summaries },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `session_search error: ${message}` }],
          details: { error: message },
        };
      }
    },
  } as any;
}
