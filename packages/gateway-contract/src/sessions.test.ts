import { describe, expect, it } from 'vitest';

import {
  buildCreateSessionPath,
  buildSessionDetailPath,
  buildSessionHistoryPath,
  buildSessionListPath,
  buildSessionRunPath,
  buildSessionActionPath,
  buildSessionResolvePath,
  buildSessionStatsPath,
  buildSidebarChatListPath,
  extractCreatedConversationId,
  normalizeSessionActiveRunResponse,
  parseSessionActionResponse,
  parseSessionRenameResponse,
  parseSessionResolveResponse,
  parseSessionResetResponse,
  parseSessionStatsResponse,
  parseSidebarChatListResponse,
  parseSessionMessagePage,
  parseSessionResponse,
  parseSessionsListResponse,
  sessionListDedupeKey,
  tryParseSessionListItem,
} from './sessions.js';

describe('sessions contract', () => {
  it('builds list paths with gateway query names', () => {
    expect(
      buildSessionListPath({
        search: 'hello',
        channel: 'webchat',
        includePinned: true,
        sessionTypes: ['chat', 'workflow'],
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        limit: 20,
        offset: 40,
      }),
    ).toBe('/api/sessions?search=hello&channel=webchat&includePinned=true&types=chat%2Cworkflow&sortBy=updatedAt&sortOrder=desc&limit=20&offset=40');
  });

  it('omits null channels for callers that intentionally request all channels', () => {
    expect(buildSessionListPath({ channel: null, limit: 10 })).toBe('/api/sessions?limit=10');
  });

  it('uses stable dedupe keys for identical list queries', () => {
    const query = { search: 'hello', limit: 20, offset: 0 };
    expect(sessionListDedupeKey(query)).toBe(sessionListDedupeKey({ ...query }));
  });

  it('parses paginated session lists without rejecting extra row fields', () => {
    const parsed = parseSessionsListResponse({
      items: [
        {
          key: 'webchat:default:direct:chat_1',
          name: 'Chat',
          messageCount: 1,
          updatedAt: '2026-07-09T00:00:00.000Z',
          custom: true,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
    expect(parsed.total).toBe(1);
    expect(tryParseSessionListItem(parsed.items[0])?.name).toBe('Chat');
  });

  it('builds detail, history, run, and create paths', () => {
    const key = "c0f12290-5df2-4203-8bfd-5d5f34467d20";
    expect(buildSessionDetailPath(key, { includeTranscript: true, includeTranscriptRows: true })).toBe(
      '/api/sessions/c0f12290-5df2-4203-8bfd-5d5f34467d20?include=transcript,transcriptRows',
    );
    expect(buildSessionHistoryPath(key, { limit: 50, before: 'cursor_1' })).toBe(
      '/api/sessions/c0f12290-5df2-4203-8bfd-5d5f34467d20/history?limit=50&before=cursor_1',
    );
    expect(buildSessionRunPath(key)).toBe(
      '/api/sessions/c0f12290-5df2-4203-8bfd-5d5f34467d20/run',
    );
    expect(buildCreateSessionPath()).toBe('/api/sessions');
  });

  it('builds stats, resolve, sidebar, and action paths', () => {
    const key = "c0f12290-5df2-4203-8bfd-5d5f34467d20";
    expect(buildSessionStatsPath()).toBe('/api/sessions/stats');
    expect(buildSessionResolvePath({ transcriptId: '117d8aa7-f120-54ad-a0dd-48a11ded92b1' })).toBe('/api/sessions/resolve?transcriptId=117d8aa7-f120-54ad-a0dd-48a11ded92b1');
    expect(buildSidebarChatListPath({ projectLimit: 10, inboxOffset: 20, includeConversationId: key })).toBe(
      '/api/sidebar/chat-list?projectLimit=10&inboxOffset=20&includeConversationId=c0f12290-5df2-4203-8bfd-5d5f34467d20',
    );
    expect(buildSessionActionPath(key, 'delete')).toBe(
      '/api/sessions/c0f12290-5df2-4203-8bfd-5d5f34467d20',
    );
    expect(buildSessionActionPath(key, 'archive')).toBe(
      '/api/sessions/c0f12290-5df2-4203-8bfd-5d5f34467d20/archive',
    );
  });

  it('parses session detail and history pages with passthrough fields', () => {
    const detail = parseSessionResponse({
      session: {
        key: '055849b2-da79-51fd-b4e6-17f7f4f3670d',
        messages: [{ role: 'user', content: 'hello', custom: true }],
        status: 'active',
        tags: [],
        createdAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-07-09T00:00:00.000Z',
        lastAccessedAt: '2026-07-09T00:00:00.000Z',
        messageCount: 1,
        estimatedTokens: 1,
        compactedCount: 0,
        sourceChannel: 'webchat',
        sourceChatId: 'chat_a',
      },
    });
    expect(detail.session.key).toBe('055849b2-da79-51fd-b4e6-17f7f4f3670d');

    const page = parseSessionMessagePage({
      session: {
        key: '055849b2-da79-51fd-b4e6-17f7f4f3670d',
        projectId: 'project-a',
        customData: { taskId: 'task-a' },
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }],
      },
      pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
    });
    expect(page.session.messages).toHaveLength(1);
    expect(page.session.projectId).toBe('project-a');
    expect(page.session.customData?.taskId).toBe('task-a');
  });

  it('normalizes active run and create responses', () => {
    expect(normalizeSessionActiveRunResponse({ payload: { active: true, runId: ' run-1 ' } })).toEqual({
      active: true,
      runId: 'run-1',
    });
    expect(normalizeSessionActiveRunResponse({ payload: { active: false } })).toEqual({ active: false });
    expect(extractCreatedConversationId({ session: { key: ' 055849b2-da79-51fd-b4e6-17f7f4f3670d ' } })).toBe('055849b2-da79-51fd-b4e6-17f7f4f3670d');
  });

  it('parses action, stats, resolve, and sidebar responses', () => {
    expect(parseSessionActionResponse({ ok: true }).ok).toBe(true);
    expect(parseSessionRenameResponse({ renamed: true }).renamed).toBe(true);
    expect(parseSessionResetResponse({ ok: true, reset: true, transcriptId: '98936ed0-fbe7-5ca2-8add-03aa88dfbc35' }).transcriptId).toBe('98936ed0-fbe7-5ca2-8add-03aa88dfbc35');
    expect(parseSessionStatsResponse({
      totalSessions: 2,
      activeSessions: 1,
      archivedSessions: 1,
      pinnedSessions: 0,
      totalMessages: 7,
      totalTokens: 1200,
      byChannel: { webchat: 2 },
    }).byChannel.webchat).toBe(2);
    expect(parseSessionResolveResponse({
      ok: true,
      payload: { conversationId: '055849b2-da79-51fd-b4e6-17f7f4f3670d', transcriptId: '117d8aa7-f120-54ad-a0dd-48a11ded92b1', session: { key: '055849b2-da79-51fd-b4e6-17f7f4f3670d' } },
    }).payload?.transcriptId).toBe('117d8aa7-f120-54ad-a0dd-48a11ded92b1');
    expect(parseSidebarChatListResponse({
      ok: true,
      projects: {
        items: [{ project: { id: 'project-a' }, sessions: [], sessionTotal: 0, sessionHasMore: false }],
        total: 1,
        limit: 12,
        offset: 0,
        hasMore: false,
      },
      inbox: { items: [], total: 0, limit: 20, offset: 0, hasMore: false },
    }).projects.total).toBe(1);
  });
});
