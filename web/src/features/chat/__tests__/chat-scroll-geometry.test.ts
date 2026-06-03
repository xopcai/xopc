import { describe, expect, it } from 'vitest';

import {
  CHAT_SCROLL_REPIN_WITHIN_PX,
  CHAT_SCROLL_UNPIN_BEYOND_PX,
  chatScrollDistanceFromBottom,
  isChatScrollNearBottomForRepin,
  isChatScrollPinnedToBottom,
  shouldFollowPinnedChatTail,
} from '@/features/chat/scroll/chat-scroll-geometry';

function mockScrollEl(params: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): HTMLElement {
  return params as unknown as HTMLElement;
}

describe('chat-scroll-geometry', () => {
  it('isChatScrollPinnedToBottom within unpin threshold', () => {
    const el = mockScrollEl({ scrollTop: 100, scrollHeight: 200, clientHeight: 96 });
    expect(chatScrollDistanceFromBottom(el)).toBe(4);
    expect(isChatScrollPinnedToBottom(el)).toBe(true);

    const scrolledUp = mockScrollEl({ scrollTop: 99, scrollHeight: 200, clientHeight: 96 });
    expect(isChatScrollPinnedToBottom(scrolledUp)).toBe(false);
  });

  it('repin hysteresis stays below unpin threshold', () => {
    expect(CHAT_SCROLL_REPIN_WITHIN_PX).toBeLessThan(CHAT_SCROLL_UNPIN_BEYOND_PX);
  });

  it('isChatScrollNearBottomForRepin only when almost flush with tail', () => {
    const almost = mockScrollEl({ scrollTop: 101, scrollHeight: 200, clientHeight: 98 });
    expect(isChatScrollNearBottomForRepin(almost)).toBe(true);

    const slightlyUp = mockScrollEl({ scrollTop: 97, scrollHeight: 200, clientHeight: 96 });
    expect(isChatScrollNearBottomForRepin(slightlyUp)).toBe(false);
  });

  it('shouldFollowPinnedChatTail when content grows but user did not scroll up', () => {
    const before = mockScrollEl({ scrollTop: 0, scrollHeight: 400, clientHeight: 600 });
    const afterFirstMessage = mockScrollEl({ scrollTop: 0, scrollHeight: 900, clientHeight: 600 });
    expect(isChatScrollPinnedToBottom(afterFirstMessage)).toBe(false);
    expect(shouldFollowPinnedChatTail(afterFirstMessage, 0, 400, true)).toBe(true);
    expect(shouldFollowPinnedChatTail(before, 0, 400, true)).toBe(true);
  });

  it('shouldFollowPinnedChatTail stops when user scrolled up', () => {
    const readingHistory = mockScrollEl({ scrollTop: 40, scrollHeight: 900, clientHeight: 600 });
    expect(shouldFollowPinnedChatTail(readingHistory, 120, 800, true)).toBe(false);
  });

  it('shouldFollowPinnedChatTail respects unpinned state', () => {
    const el = mockScrollEl({ scrollTop: 0, scrollHeight: 900, clientHeight: 600 });
    expect(shouldFollowPinnedChatTail(el, 0, 400, false)).toBe(false);
  });
});
