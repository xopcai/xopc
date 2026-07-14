import { describe, expect, it } from 'vitest';

import { isForcedNewChatNavigation } from '@/features/chat/session/use-chat-session-route';

describe('isForcedNewChatNavigation', () => {
  it('recognizes only the explicit new-chat navigation intent', () => {
    expect(isForcedNewChatNavigation({ forceNewChat: true })).toBe(true);
    expect(isForcedNewChatNavigation({ forceNewChat: false })).toBe(false);
    expect(isForcedNewChatNavigation({})).toBe(false);
    expect(isForcedNewChatNavigation(null)).toBe(false);
  });
});
