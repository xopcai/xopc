import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { explicitlyReadsOriginalHistory, forgottenHistoryEntries, FORGOTTEN_HISTORY_EXCERPT } from '../../memory-learning/forgotten-history.js';
import type { CaptureScopeContext } from '../../user-model/capture/executor.js';
import type { SessionStore } from '../../session/store.js';

const SessionRecallSchema = Type.Object({
  query: Type.String({
    minLength: 1,
    maxLength: 500,
    description: 'Keywords, an exact phrase, path, URL, ID, date, or name to find in this session.',
  }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 8 })),
  beforeSeq: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Return matches older than this transcript sequence number.',
  })),
  maxCharsPerResult: Type.Optional(Type.Integer({ minimum: 500, maximum: 20_000, default: 6_000 })),
});

interface SessionRecallParams {
  query: string;
  limit?: number;
  beforeSeq?: number;
  maxCharsPerResult?: number;
}

export interface SessionRecallToolDeps {
  getSessionStore: () => SessionStore;
  getCurrentConversationId: () => string | undefined;
  maxOutputChars?: number;
  getHistoryContext?: () => CaptureScopeContext;
  getCurrentUserText?: () => string | undefined;
}

function excerpt(content: string, query: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const matchAt = content.toLowerCase().indexOf(query.toLowerCase());
  const center = matchAt >= 0 ? matchAt + Math.floor(query.length / 2) : Math.floor(content.length / 2);
  const start = Math.max(0, Math.min(content.length - maxChars, center - Math.floor(maxChars / 2)));
  const end = Math.min(content.length, start + maxChars);
  return `${start > 0 ? '…\n' : ''}${content.slice(start, end)}${end < content.length ? '\n…' : ''}`;
}

export function createSessionRecallTool(deps: SessionRecallToolDeps): AgentTool {
  return {
    name: 'session_recall',
    label: 'Session recall',
    description:
      'Search the authoritative raw transcript of the current session, including turns older than context compaction. Use when a continuation summary lacks an exact fact, quote, path, URL, ID, date, decision, or tool outcome. This tool cannot access other sessions.',
    parameters: SessionRecallSchema,
    supportsParallel: true,
    idempotent: true,

    async execute(_toolCallId, params): Promise<any> {
      const input = params as SessionRecallParams;
      const conversationId = deps.getCurrentConversationId();
      if (!conversationId) {
        return {
          content: [{ type: 'text', text: 'session_recall is unavailable outside an active session.' }],
          details: { error: 'missing_session' },
        };
      }
      const query = input.query.trim();
      const limit = Math.min(20, Math.max(1, input.limit ?? 8));
      const maxChars = Math.min(20_000, Math.max(500, input.maxCharsPerResult ?? 6_000));
      const matches = deps.getSessionStore().recallSession(conversationId, query, {
        limit,
        ...(input.beforeSeq ? { beforeSeq: input.beforeSeq } : {}),
        ...(deps.maxOutputChars ? { orderBySeq: true } : {}),
      });
      const protectedEntries = deps.getHistoryContext ? forgottenHistoryEntries(deps.getHistoryContext(), deps.getCurrentUserText?.()) : new Set<string>();
      for (const match of matches) {
        if (protectedEntries.has(`${conversationId}:*`) || protectedEntries.has(`${conversationId}:${match.entryId}`)) match.content = FORGOTTEN_HISTORY_EXCERPT;
      }
      if (deps.maxOutputChars) matches.sort((a, b) => b.seq - a.seq);
      const results = matches.map((match) => ({
        seq: match.seq,
        entryId: match.entryId,
        role: match.role,
        createdAt: new Date(match.createdAt).toISOString(),
        content: excerpt(match.content, query, maxChars),
        ...(deps.maxOutputChars ? { truncated: match.content.length > maxChars } : {}),
      }));
      const payloadFor = () => {
        const nextBeforeSeq = results.length && (results.length < matches.length || matches.length === limit)
          ? Math.min(...results.map(result => result.seq)) : undefined;
        return { success: true, query, results, count: results.length,
          ...(explicitlyReadsOriginalHistory(deps.getCurrentUserText?.() ?? '') ? {
            historyScope: 'current_conversation_only',
            guidance: 'This tool cannot search other conversations. Use session_search for original records elsewhere; these results do not establish that no original record exists.',
          } : {}),
          ...(deps.maxOutputChars ? { excerpts: true, truncated: results.length < matches.length || results.some(result => result.truncated) } : {}),
          ...(nextBeforeSeq ? { nextBeforeSeq } : {}) };
      };
      let payload = payloadFor();
      let text = JSON.stringify(payload, null, 2);
      if (deps.maxOutputChars) {
        while (text.length > deps.maxOutputChars && results.length) {
          if (results.length > 1) results.pop();
          else if (results[0].content.length > 100) {
            const match = matches[0];
            results[0].content = excerpt(match.content, query, Math.floor(results[0].content.length / 2));
            results[0].truncated = true;
          } else break;
          payload = payloadFor();
          text = JSON.stringify(payload, null, 2);
        }
        if (text.length > deps.maxOutputChars) {
          return { content: [{ type: 'text', text: JSON.stringify({ query: query.slice(0, 500), conversationId,
            requiresSpecialist: true, complete: false, reason: 'large_transcript',
            guidance: 'Delegate a complete read using the conversation ID and query.' }) }],
            details: { requiresSpecialist: true, complete: false } };
        }
      }
      return {
        content: [{ type: 'text', text }],
        details: payload,
      };
    },
  } as AgentTool;
}
