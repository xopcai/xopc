import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearChatRunPresence,
  markChatRunCompleted,
  markChatRunFailed,
  markChatRunRunning,
  useChatRunPresenceStore,
} from '@/features/chat/session/chat-run-presence-store';

describe('chat run presence store', () => {
  beforeEach(() => {
    useChatRunPresenceStore.setState({ runs: {} });
  });

  it('tracks a background completion until the session is viewed', () => {
    markChatRunRunning('agent:main:web:one');
    markChatRunCompleted('agent:main:web:one', true);

    expect(useChatRunPresenceStore.getState().runs['agent:main:web:one']).toEqual(
      expect.objectContaining({ status: 'completed', unread: true }),
    );

    useChatRunPresenceStore.getState().markViewed('agent:main:web:one');

    expect(useChatRunPresenceStore.getState().runs['agent:main:web:one']?.unread).toBe(false);
  });

  it('replaces a previous terminal result when a new run starts', () => {
    markChatRunFailed('agent:main:web:one', true);
    markChatRunRunning('agent:main:web:one');

    expect(useChatRunPresenceStore.getState().runs['agent:main:web:one']).toEqual(
      expect.objectContaining({ status: 'running', unread: false }),
    );
  });

  it('clears aborted or expired runs', () => {
    markChatRunRunning('agent:main:web:one');
    clearChatRunPresence('agent:main:web:one');

    expect(useChatRunPresenceStore.getState().runs['agent:main:web:one']).toBeUndefined();
  });
});
