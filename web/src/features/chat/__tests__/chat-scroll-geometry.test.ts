import { describe, expect, it } from 'vitest';

import {
  CHAT_SCROLL_NEAR_BOTTOM_PX,
  chatScrollDistanceFromBottom,
  isNearChatBottom,
  scrollChatToEnd,
} from '@/features/chat/scroll/chat-scroll-geometry';

function mockScrollEl(params: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): HTMLElement {
  return params as unknown as HTMLElement;
}

describe('chat-scroll-geometry', () => {
  it('isNearChatBottom within threshold', () => {
    const near = mockScrollEl({ scrollTop: 100, scrollHeight: 200, clientHeight: 96 });
    expect(chatScrollDistanceFromBottom(near)).toBe(4);
    expect(isNearChatBottom(near)).toBe(true);

    const far = mockScrollEl({ scrollTop: 0, scrollHeight: 200, clientHeight: 96 });
    expect(isNearChatBottom(far)).toBe(false);
  });

  it('uses a generous follow threshold like Cursor chat', () => {
    expect(CHAT_SCROLL_NEAR_BOTTOM_PX).toBeGreaterThanOrEqual(24);
  });

  it('scrollChatToEnd sets scrollTop to scrollHeight', () => {
    const el = mockScrollEl({ scrollTop: 0, scrollHeight: 1200, clientHeight: 600 });
    scrollChatToEnd(el);
    expect(el.scrollTop).toBe(1200);
  });
});
