import { describe, expect, it } from 'vitest';

import {
  extractCreatedConversationId,
  normalizeSessionActiveRunResponse,
  parseSessionActionResponse,
  parseSessionMessagePage,
  parseSessionRenameResponse,
  parseSessionResponse,
  parseSessionResolveResponse,
  parseSessionResetResponse,
  parseSessionStatsResponse,
  parseSessionsListResponse,
  parseSidebarChatListResponse,
  tryParseSessionListItem,
} from './sessions.js';

describe('sessions backend response contract', () => {
  it('accepts the gateway session list response shape', () => {
    const response = {
      items: [
        {
          key: "c0f12290-5df2-4203-8bfd-5d5f34467d20",
          name: 'Planning',
          status: 'active',
          tags: [],
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:10:00.000Z',
          lastAccessedAt: '2026-07-09T00:10:00.000Z',
          messageCount: 3,
          estimatedTokens: 320,
          compactedCount: 0,
          sourceChannel: 'webchat',
          sourceChatId: 'chat_a',
          routing: {
            agentId: 'main',
            source: 'webchat',
            accountId: 'default',
            peerKind: 'direct',
            peerId: 'chat_a',
          },
          transcriptId: '117d8aa7-f120-54ad-a0dd-48a11ded92b1',
          sessionStartedAt: '2026-07-09T00:00:00.000Z',
          lastInteractionAt: '2026-07-09T00:10:00.000Z',
          customData: { genericNewChatShell: false },
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    };

    const parsed = parseSessionsListResponse(response);
    const first = tryParseSessionListItem(parsed.items[0]);
    expect(parsed.total).toBe(1);
    expect(first?.key).toBe("c0f12290-5df2-4203-8bfd-5d5f34467d20");
    expect(first?.routing?.agentId).toBe('main');
  });

  it('accepts the gateway session detail response shape', () => {
    const response = {
      session: {
        key: "c0f12290-5df2-4203-8bfd-5d5f34467d20",
        name: 'Planning',
        status: 'active',
        tags: [],
        createdAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-07-09T00:10:00.000Z',
        lastAccessedAt: '2026-07-09T00:10:00.000Z',
        messageCount: 2,
        estimatedTokens: 128,
        compactedCount: 0,
        sourceChannel: 'webchat',
        sourceChatId: 'chat_a',
        transcriptId: '117d8aa7-f120-54ad-a0dd-48a11ded92b1',
        messages: [
          { role: 'user', content: 'hello', timestamp: '2026-07-09T00:00:01.000Z' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            timestamp: '2026-07-09T00:00:02.000Z',
          },
        ],
        transcriptSummary: {
          id: 'transcript_a',
          version: 1,
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:10:00.000Z',
          compactionCount: 0,
        },
        transcriptRows: [
          { id: 'row_1', kind: 'message', role: 'user', content: 'hello' },
          { id: 'row_2', kind: 'context', text: 'audit-only row' },
        ],
      },
    };

    const parsed = parseSessionResponse(response);
    expect(parsed.session.messages).toHaveLength(2);
    expect(parsed.session.transcriptSummary?.id).toBe('transcript_a');
    expect(parsed.session.transcriptRows).toHaveLength(2);
  });

  it('accepts the gateway history page response shape', () => {
    const response = {
      session: {
        key: "c0f12290-5df2-4203-8bfd-5d5f34467d20",
        transcriptId: '117d8aa7-f120-54ad-a0dd-48a11ded92b1',
        name: 'Planning',
        status: 'active',
        sourceChannel: 'webchat',
        sourceChatId: 'chat_a',
        routing: { agentId: 'main' },
        messages: [
          { role: 'user', content: 'hello', timestamp: 1_784_064_000_000 },
          { role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: 1_784_064_001_000 },
        ],
      },
      pagination: {
        total: 2,
        limit: 50,
        offset: 0,
        hasMore: false,
        nextBeforeCursor: 'row_1',
      },
    };

    const parsed = parseSessionMessagePage(response);
    expect(parsed.pagination.nextBeforeCursor).toBe('row_1');
    expect(parsed.session.routing?.agentId).toBe('main');
    expect(parsed.session.messages[0]?.timestamp).toBe(1_784_064_000_000);
  });

  it('accepts active run and create session response shapes', () => {
    expect(normalizeSessionActiveRunResponse({
      ok: true,
      payload: { active: true, runId: ' run-a ' },
    })).toEqual({ active: true, runId: 'run-a' });

    expect(extractCreatedConversationId({
      session: {
        key: ' 2f414f56-2a1f-4889-8328-d4f8510d3a95 ',
        transcriptId: '23c6e1ec-2563-510e-be85-6d9e619d2f10',
      },
    })).toBe("2f414f56-2a1f-4889-8328-d4f8510d3a95");
  });

  it('accepts gateway action and reset response shapes', () => {
    expect(parseSessionActionResponse({ ok: true, deleted: true }).ok).toBe(true);
    expect(parseSessionActionResponse({ ok: false, error: 'Session not found' }).error).toBe('Session not found');
    expect(parseSessionRenameResponse({ renamed: true }).renamed).toBe(true);
    expect(parseSessionResetResponse({
      ok: true,
      reset: true,
      transcriptId: '23c6e1ec-2563-510e-be85-6d9e619d2f10',
      previousTranscriptId: 'sess_old',
      session: { key: "c0f12290-5df2-4203-8bfd-5d5f34467d20" },
    }).previousTranscriptId).toBe('sess_old');
  });

  it('accepts gateway stats and resolve response shapes', () => {
    expect(parseSessionStatsResponse({
      totalSessions: 5,
      activeSessions: 3,
      archivedSessions: 1,
      pinnedSessions: 1,
      totalMessages: 42,
      totalTokens: 9000,
      oldestSession: '2026-07-01T00:00:00.000Z',
      newestSession: '2026-07-09T00:00:00.000Z',
      byChannel: { webchat: 4, telegram: 1 },
    }).totalSessions).toBe(5);

    expect(parseSessionResolveResponse({
      ok: true,
      payload: {
        conversationId: "c0f12290-5df2-4203-8bfd-5d5f34467d20",
        transcriptId: '117d8aa7-f120-54ad-a0dd-48a11ded92b1',
        session: { key: "c0f12290-5df2-4203-8bfd-5d5f34467d20", transcriptId: '117d8aa7-f120-54ad-a0dd-48a11ded92b1' },
      },
    }).payload?.conversationId).toBe("c0f12290-5df2-4203-8bfd-5d5f34467d20");

    expect(parseSessionResolveResponse({ ok: false, error: 'Session not found' }).error).toBe('Session not found');
  });

  it('accepts gateway sidebar chat-list response shape', () => {
    const response = {
      ok: true,
      projects: {
        items: [
          {
            project: { id: 'project-a', name: 'Project A' },
            sessions: [
              {
                key: "c0f12290-5df2-4203-8bfd-5d5f34467d20",
                status: 'active',
                tags: [],
                createdAt: '2026-07-09T00:00:00.000Z',
                updatedAt: '2026-07-09T00:10:00.000Z',
                lastAccessedAt: '2026-07-09T00:10:00.000Z',
                messageCount: 1,
                estimatedTokens: 120,
                compactedCount: 0,
                sourceChannel: 'webchat',
                sourceChatId: 'chat_a',
              },
            ],
            sessionTotal: 1,
            sessionHasMore: false,
          },
        ],
        total: 1,
        limit: 12,
        offset: 0,
        hasMore: false,
      },
      inbox: {
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
    };

    const parsed = parseSidebarChatListResponse(response);
    expect(parsed.projects.items[0].sessionTotal).toBe(1);
    expect(parsed.inbox.total).toBe(0);
  });
});
