import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

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
  getCurrentSessionKey: () => string | undefined;
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
      const sessionKey = deps.getCurrentSessionKey();
      if (!sessionKey) {
        return {
          content: [{ type: 'text', text: 'session_recall is unavailable outside an active session.' }],
          details: { error: 'missing_session' },
        };
      }
      const query = input.query.trim();
      const limit = Math.min(20, Math.max(1, input.limit ?? 8));
      const maxChars = Math.min(20_000, Math.max(500, input.maxCharsPerResult ?? 6_000));
      const matches = deps.getSessionStore().recallSession(sessionKey, query, {
        limit,
        ...(input.beforeSeq ? { beforeSeq: input.beforeSeq } : {}),
      });
      const results = matches.map((match) => ({
        seq: match.seq,
        entryId: match.entryId,
        role: match.role,
        createdAt: new Date(match.createdAt).toISOString(),
        content: excerpt(match.content, query, maxChars),
      }));
      const nextBeforeSeq = results.length === limit
        ? Math.min(...results.map((result) => result.seq))
        : undefined;
      const payload = {
        success: true,
        query,
        results,
        count: results.length,
        ...(nextBeforeSeq ? { nextBeforeSeq } : {}),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  } as AgentTool;
}
