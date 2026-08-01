// Cross-session transcript search + optional LLM summaries
import { Type } from '@sinclair/typebox';
import type { AgentMessage, AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { type Api, type Model, type UserMessage } from '@earendil-works/pi-ai/compat';

import { resolveModel } from '../../providers/index.js';
import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import type { SessionStore } from '../../session/store.js';
import { createLogger } from '../../utils/logger.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';

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
  logMeta?: { summarizingSessionKey: string },
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
        summarizingSessionKey: logMeta?.summarizingSessionKey,
        queryLength: query.length,
        messageCount: messages.length,
      },
      `session_search LLM summarization failed${logMeta?.summarizingSessionKey ? ` (session ${logMeta.summarizingSessionKey})` : ''}: ${msg}`,
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
  excludeSessionKey: Type.Optional(
    Type.String({ description: 'Exclude this session key from keyword results (default: current chat).' }),
  ),
});

export interface SessionSearchToolDeps {
  getSessionStore: () => SessionStore;
  getPrimaryModel: () => Model<Api>;
  getCurrentSessionKey?: () => string | undefined;
}

type SessionSearchParams = {
  query?: string;
  roleFilter?: 'user' | 'assistant' | 'system' | 'tool' | 'toolResult';
  limit?: number;
  excludeSessionKey?: string;
};

export function createSessionSearchTool(deps: SessionSearchToolDeps): AgentTool {
  return {
    name: 'session_search',
    label: 'Session search',
    description:
      'Search other chat sessions by keywords and get short summaries, or omit `query` to list recent sessions (no LLM cost). Uses the same session store as the gateway. Narrow with roleFilter if needed.',
    parameters: SessionSearchSchema,

    async execute(
      _toolCallId: string,
      params: any,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const p = params as SessionSearchParams;
      const store = deps.getSessionStore();
      const limit = Math.min(15, Math.max(1, p.limit ?? 5));
      const query = p.query?.trim() ?? '';

      try {
        if (!query) {
          const listed = await store.list({
            limit: limit + 5,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          });
          const items = listed.items.slice(0, limit).map((s) => ({
            key: s.key,
            name: s.name,
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

        const exclude = p.excludeSessionKey?.trim() || deps.getCurrentSessionKey?.() || '';
        if (exclude) {
          matches = matches.filter((m) => m.key !== exclude);
        }

        const top = matches.slice(0, limit);

        const summaries = await Promise.all(
          top.map(async ({ key, score }) => {
            let messages = await store.load(key);

            if (p.roleFilter) {
              messages = messages.filter((m) => m.role === p.roleFilter);
            }

            const summary = await summarizeSession(messages, query, deps, signal, {
              summarizingSessionKey: key,
            });
            return { sessionKey: key, score, summary };
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
