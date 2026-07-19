import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { SessionMessagePage } from '../../../query/sessions';
import { mergeLatestSessionHistoryPage } from '../session-message-parser';

function page(options: {
  sessionId: string;
  messages: Array<Record<string, unknown>>;
  hasMore: boolean;
  total?: number;
}): SessionMessagePage {
  return {
    session: {
      key: 'agent:main:webchat:default:direct:chat-a',
      sessionId: options.sessionId,
      messages: options.messages as SessionMessagePage['session']['messages'],
    },
    pagination: {
      total: options.total ?? options.messages.length,
      limit: 50,
      offset: 0,
      hasMore: options.hasMore,
      nextBeforeCursor: options.hasMore ? 'older' : undefined,
    },
  };
}

function infinite(pages: SessionMessagePage[]): InfiniteData<SessionMessagePage | null, string | undefined> {
  return {
    pages,
    pageParams: pages.map((_, index) => index === 0 ? undefined : `cursor-${index}`),
  };
}

describe('latest session history reconciliation', () => {
  it('replaces all local pages when the server returns a complete snapshot', () => {
    const old = infinite([
      page({ sessionId: 's1', messages: [{ id: 'old', role: 'user', content: 'old' }], hasMore: true }),
      page({ sessionId: 's1', messages: [{ id: 'older', role: 'assistant', content: 'older' }], hasMore: false }),
    ]);
    const latest = page({ sessionId: 's1', messages: [], hasMore: false, total: 0 });

    expect(mergeLatestSessionHistoryPage(old, latest)).toEqual({
      pages: [latest],
      pageParams: [undefined],
    });
  });

  it('drops pages from a transcript that was reset under the same key', () => {
    const old = infinite([
      page({ sessionId: 'before-reset', messages: [{ id: 'old', role: 'user', content: 'old' }], hasMore: true }),
    ]);
    const latest = page({
      sessionId: 'after-reset',
      messages: [{ id: 'new', role: 'user', content: 'new' }],
      hasMore: true,
      total: 100,
    });

    expect(mergeLatestSessionHistoryPage(old, latest)).toEqual({
      pages: [latest],
      pageParams: [undefined],
    });
  });

  it('preserves only genuinely older pages after an overlapping head refresh', () => {
    const oldHead = page({
      sessionId: 's1',
      messages: [{ id: 'm2', role: 'assistant', content: 'two' }],
      hasMore: true,
    });
    const oldTail = page({
      sessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: 'one' }],
      hasMore: false,
    });
    const latest = page({
      sessionId: 's1',
      messages: [
        { id: 'm2', role: 'assistant', content: 'two' },
        { id: 'm3', role: 'user', content: 'three' },
      ],
      hasMore: true,
    });

    expect(mergeLatestSessionHistoryPage(infinite([oldHead, oldTail]), latest)).toEqual({
      pages: [latest, oldTail],
      pageParams: [undefined, 'cursor-1'],
    });
  });
});
