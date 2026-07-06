import { describe, expect, it } from 'vitest';

import {
  applyPinHysteresis,
  chatListDistanceFromBottom,
  CHAT_LIST_REPIN_WITHIN_PX,
  CHAT_LIST_UNPIN_BEYOND_PX,
  isUserScrollTowardHistory,
} from '../chat-scroll-geometry';

describe('chatListDistanceFromBottom', () => {
  it('returns zero when scrolled to the end', () => {
    expect(chatListDistanceFromBottom(900, 1000, 100)).toBe(0);
  });

  it('returns positive distance when not at bottom', () => {
    expect(chatListDistanceFromBottom(800, 1000, 100)).toBe(100);
  });
});

describe('applyPinHysteresis', () => {
  it('stays pinned while within unpin threshold', () => {
    expect(applyPinHysteresis(true, CHAT_LIST_UNPIN_BEYOND_PX)).toBe(true);
    expect(applyPinHysteresis(true, CHAT_LIST_UNPIN_BEYOND_PX - 1)).toBe(true);
  });

  it('unpins when beyond unpin threshold', () => {
    expect(applyPinHysteresis(true, CHAT_LIST_UNPIN_BEYOND_PX + 1)).toBe(false);
  });

  it('stays unpinned until within repin threshold', () => {
    expect(applyPinHysteresis(false, CHAT_LIST_REPIN_WITHIN_PX)).toBe(false);
    expect(applyPinHysteresis(false, CHAT_LIST_REPIN_WITHIN_PX - 1)).toBe(true);
  });
});

describe('isUserScrollTowardHistory', () => {
  it('detects upward scroll when content grows', () => {
    expect(isUserScrollTowardHistory(500, 600, 1200, 1000)).toBe(true);
  });

  it('ignores offset drop when content shrank (layout clamp at tail)', () => {
    expect(isUserScrollTowardHistory(580, 600, 980, 1000)).toBe(false);
  });
});
