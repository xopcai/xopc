// Cross-session transcript search + optional LLM summaries
import { Type } from '@sinclair/typebox';
import type { AgentMessage, AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { type Api, type Model, type UserMessage } from '@earendil-works/pi-ai/compat';

import { resolveModel } from '../../providers/index.js';
import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import type { SessionStore } from '../../session/store.js';
import { createLogger } from '../../utils/logger.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';
import { projectUnadmittedForgottenFields, forgottenHistoryEntries, FORGOTTEN_HISTORY_EXCERPT } from '../../memory-learning/forgotten-history.js';
import type { CaptureScopeContext } from '../../user-model/capture/executor.js';
import { sessionSearchTerms } from '../../storage/sqlite/fts.js';
import { LOCAL_READ_MAX_CHARS } from './local-read-budget.js';

const log = createLogger('Agent:SessionSearch');

const MAX_SUMMARY_CHARS = 20_000;

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
  const prompt = `Summarize this conversation for someone searching with: "${query}". Focus on facts, decisions, and names. Max 200 words. Use the same language as the conversation when possible.

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

const SessionSearchSchema = Type.Object({
  query: Type.Optional(
    Type.String({ description: 'Keyword search over past sessions. Omit to list recent sessions.' }),
  ),
  roleFilter: Type.Optional(
    Type.Union([
      Type.Literal('user'),
      Type.Literal('assistant'),
      Type.Literal('system'),
      Type.Literal('tool'),
      Type.Literal('toolResult'),
    ]),
  ),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 15 })),
  excludeConversationId: Type.Optional(
    Type.String({ description: 'Exclude this session key from keyword results (default: current chat).' }),
  ),
});

export interface SessionSearchToolDeps {
  getSessionStore: () => SessionStore;
  getPrimaryModel: () => Model<Api>;
  getCurrentConversationId?: () => string | undefined;
  canAccess?: () => boolean;
  localOnly?: boolean;
  getHistoryContext?: () => CaptureScopeContext;
  getCurrentUserText?: () => string | undefined;
}

type SessionSearchParams = {
  query?: string;
  roleFilter?: 'user' | 'assistant' | 'system' | 'tool' | 'toolResult';
  limit?: number;
  excludeConversationId?: string;
};

export function createSessionSearchTool(deps: SessionSearchToolDeps): AgentTool {
  return {
    name: 'session_search',
    label: 'Session search',
    description: deps.localOnly
      ? 'Search other chats locally and return short matching transcript excerpts. Omit query to list recent chats. No model or network calls.'
      : 'Search other chat sessions by keywords and get short summaries, or omit `query` to list recent sessions (no LLM cost). Uses the same session store as the gateway. Narrow with roleFilter if needed.',
    parameters: deps.localOnly ? Type.Object({ ...SessionSearchSchema.properties,
      query: Type.Optional(Type.String({ maxLength: 500, description: 'Keywords for other chats; omit to list recent chats.' })),
    }) : SessionSearchSchema,
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
      const limit = Math.min(deps.localOnly ? 5 : 15, Math.max(1, p.limit ?? (deps.localOnly ? 3 : 5)));
      const query = p.query?.trim() ?? '';
      if (deps.localOnly && query.length > 500) {
        return { content: [{ type: 'text', text: 'Use at most 500 characters of search keywords.' }],
          details: { error: 'invalid_query' } };
      }
      const store = deps.getSessionStore();

      try {
        const protectedEntries = deps.getHistoryContext ? forgottenHistoryEntries(deps.getHistoryContext(), deps.getCurrentUserText?.()) : new Set<string>();
        const projectTitle = (key: string, name: string | undefined) => {
          if (name === undefined) return name;
          const projected = [...protectedEntries].some(entry => entry.startsWith(`${key}:`)) ? FORGOTTEN_HISTORY_EXCERPT
            : deps.getHistoryContext ? projectUnadmittedForgottenFields(name, deps.getHistoryContext(), deps.getCurrentUserText?.()) : name;
          return deps.localOnly ? projected.slice(0, 200) : projected;
        };
        if (!query) {
          const listed = await store.list({
            limit: limit + 5,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          });
          const items = listed.items.slice(0, limit).map((s) => ({
            key: s.key,
            name: projectTitle(s.key, s.name),
            updatedAt: s.updatedAt,
            messageCount: s.messageCount,
            sourceChannel: s.sourceChannel,
          }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { success: true, mode: 'recent', results: items, total: listed.total },
                  null,
                  2,
                ),
              },
            ],
            details: { mode: 'recent', items },
          };
        }

        const listed = await store.list({
          search: query,
          limit: limit + 10,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        });
        let matches = listed.items.map((item) => ({ key: item.key, score: 1 }));

        const exclude = p.excludeConversationId?.trim() || deps.getCurrentConversationId?.() || '';
        if (exclude) {
          matches = matches.filter((m) => m.key !== exclude);
        }

        const top = matches.slice(0, limit);
        if (deps.localOnly) {
          const results = top.map(({ key }) => ({
            conversationId: key,
            name: projectTitle(key, listed.items.find(item => item.key === key)?.name),
            excerpts: store.recallSession(key, query, { limit: 2, matchMode: 'keyword' })
              .filter(match => !p.roleFilter || match.role === p.roleFilter)
              .map(match => {
                const content = (protectedEntries.has(`${key}:*`) || protectedEntries.has(`${key}:${match.entryId}`)) ? FORGOTTEN_HISTORY_EXCERPT : deps.getHistoryContext ? projectUnadmittedForgottenFields(match.content, deps.getHistoryContext(), deps.getCurrentUserText?.()) : match.content;
                const positions = sessionSearchTerms(query).map(term => content.toLowerCase().indexOf(term.toLowerCase())).filter(at => at >= 0);
                const at = positions.length ? Math.min(...positions) : 0;
                const start = Math.max(0, at - 200);
                return { entryId: match.entryId, createdAt: match.createdAt, seq: match.seq, role: match.role,
                  content: content.slice(start, start + 800),
                  truncated: start > 0 || content.length > start + 800 };
              }),
          }));
          const payload = { success: true, mode: 'keyword', query, results, truncated: false };
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
          return { content: [{ type: 'text', text: JSON.stringify(payload) }],
            details: { localOnly: true, count: results.length } };
        }

        const summaries = await Promise.all(
          top.map(async ({ key, score }) => {
            if ([...protectedEntries].some(entry => entry.startsWith(`${key}:`))) {
              return { conversationId: key, score, summary: FORGOTTEN_HISTORY_EXCERPT };
            }
            let messages = await store.load(key);
            if (deps.getHistoryContext) messages = projectUnadmittedForgottenFields(messages, deps.getHistoryContext(), deps.getCurrentUserText?.());

            if (p.roleFilter) {
              messages = messages.filter((m) => m.role === p.roleFilter);
            }

            const summary = await summarizeSession(messages, query, deps, signal, {
              summarizingConversationId: key,
            });
            return { conversationId: key, score, summary };
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
