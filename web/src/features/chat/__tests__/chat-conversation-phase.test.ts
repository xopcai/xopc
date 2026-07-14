import { describe, expect, it } from 'vitest';

import { resolveChatConversationPhase } from '@/features/chat/session/chat-conversation-phase';

describe('resolveChatConversationPhase', () => {
  it('renders the intentional new-chat route as an empty-chat creation state, not history loading', () => {
    expect(
      resolveChatConversationPhase({
        isNewRoute: true,
        sessionRoutePending: false,
        showSessionLoading: true,
        sessionContentLoading: false,
        messageCount: 0,
      }),
    ).toBe('creating-session');
  });

  it('uses one history-loading state for route and transcript transitions', () => {
    expect(
      resolveChatConversationPhase({
        isNewRoute: false,
        sessionRoutePending: true,
        showSessionLoading: false,
        sessionContentLoading: false,
        messageCount: 0,
      }),
    ).toBe('loading-history');

    expect(
      resolveChatConversationPhase({
        isNewRoute: false,
        sessionRoutePending: false,
        showSessionLoading: false,
        sessionContentLoading: true,
        messageCount: 0,
      }),
    ).toBe('loading-history');
  });

  it('distinguishes a ready empty conversation from one with messages', () => {
    const base = {
      isNewRoute: false,
      sessionRoutePending: false,
      showSessionLoading: false,
      sessionContentLoading: false,
    };

    expect(resolveChatConversationPhase({ ...base, messageCount: 0 })).toBe('ready-empty');
    expect(resolveChatConversationPhase({ ...base, messageCount: 1 })).toBe('ready-conversation');
  });
});
