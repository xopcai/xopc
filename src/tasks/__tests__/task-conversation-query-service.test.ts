import { describe, expect, it, vi } from 'vitest';

import { TaskConversationQueryService } from '../../gateway/service/task-conversation-query-service.js';
import type { TaskSessionLink } from '../task-conversation-repository.js';

function link(conversationId: string, assignmentEpoch: number, status: TaskSessionLink['status']): TaskSessionLink {
  return {
    id: `link-${assignmentEpoch}`,
    taskId: 'task-1',
    conversationId,
    role: 'execution',
    agentId: `agent-${assignmentEpoch}`,
    assignmentEpoch,
    status,
    startedAt: assignmentEpoch * 100,
    createdAt: assignmentEpoch * 100,
  };
}

describe('TaskConversationQueryService', () => {
  it('paginates one logical history across execution sessions', async () => {
    const rows = new Map([
      ['old', [{ role: 'user', content: 'old-1' }, { role: 'assistant', content: 'old-2' }]],
      ['active', [{ role: 'user', content: 'new-1' }, { role: 'assistant', content: 'new-2' }]],
    ]);
    const getMessagePage = vi.fn(async (conversationId: string, options: { limit?: number; offset?: number }) => {
      const all = rows.get(conversationId)!;
      const limit = options.limit ?? 50;
      const end = all.length - (options.offset ?? 0);
      const messages = all.slice(Math.max(0, end - limit), end);
      return {
        session: { key: conversationId, messages },
        pagination: { total: all.length, limit, offset: options.offset ?? 0, hasMore: end - limit > 0 },
      };
    });
    const service = new TaskConversationQueryService(
      { getMessagePage, getTimeline: vi.fn() } as never,
      { listSessions: () => [link('active', 2, 'active'), link('old', 1, 'superseded')] },
    );

    const tail = await service.getMessagePage('task-1', { limit: 3, offset: 0 });
    expect(tail?.session.messages.map((message) => message.content)).toEqual(['old-2', 'new-1', 'new-2']);
    expect(tail?.pagination).toMatchObject({ total: 4, hasMore: true, nextBeforeCursor: '1' });

    const older = await service.getMessagePage('task-1', { limit: 3, offset: 0, before: 1 });
    expect(older?.session.messages.map((message) => message.content)).toEqual(['old-1']);
    expect(older?.pagination.hasMore).toBe(false);
  });

  it('adds an execution boundary to the combined timeline', async () => {
    const getMessagePage = vi.fn(async (conversationId: string) => ({
      session: { key: conversationId, messages: [] },
      pagination: { total: 1, limit: 1, offset: 0, hasMore: false },
    }));
    const getTimeline = vi.fn(async (conversationId: string) => [{
      id: `${conversationId}-turn`,
      kind: 'turn' as const,
      title: conversationId,
      depth: 0,
      turn: 0,
      displayIndex: 0,
    }]);
    const service = new TaskConversationQueryService(
      { getMessagePage, getTimeline } as never,
      { listSessions: () => [link('active', 2, 'active'), link('old', 1, 'superseded')] },
    );

    const timeline = await service.getTimeline('task-1');
    expect(timeline?.map((item) => [item.kind, item.displayIndex])).toEqual([
      ['turn', 0],
      ['branch', 1],
      ['turn', 1],
    ]);
  });

  it('offsets find results across execution sessions', async () => {
    const totals = new Map([['old', 3], ['active', 2]]);
    const getMessagePage = vi.fn(async (conversationId: string) => ({
      session: { key: conversationId, messages: [] },
      pagination: { total: totals.get(conversationId)!, limit: 1, offset: 0, hasMore: false },
    }));
    const findMessages = vi.fn(async (conversationId: string) => ({
      query: 'needle',
      total: 1,
      truncated: false,
      matches: [{ displayIndex: conversationId === 'old' ? 1 : 0, occurrence: 0 }],
    }));
    const getTimeline = vi.fn(async (conversationId: string) =>
      Array.from({ length: totals.get(conversationId)! }, (_, displayIndex) => ({
        id: `${conversationId}-${displayIndex}`,
        kind: 'turn' as const,
        title: 'message',
        turn: displayIndex,
        depth: 0,
        displayIndex,
      })));
    const service = new TaskConversationQueryService(
      { findMessages, getMessagePage, getTimeline } as never,
      { listSessions: () => [link('active', 2, 'active'), link('old', 1, 'superseded')] },
    );

    await expect(service.findMessages('task-1', 'needle')).resolves.toEqual({
      query: 'needle',
      total: 2,
      truncated: false,
      matches: [
        { displayIndex: 1, occurrence: 0 },
        { displayIndex: 3, occurrence: 0 },
      ],
    });
  });
});
