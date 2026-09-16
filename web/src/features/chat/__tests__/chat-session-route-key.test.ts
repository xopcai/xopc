import { describe, expect, it } from 'vitest';

import { decodeConcreteConversationId } from '../session/chat-session-view';

describe('decodeConcreteConversationId', () => {
  it('does not expose the /chat/new placeholder as a session key', () => {
    expect(decodeConcreteConversationId(true, 'new')).toBeUndefined();
  });

  it('decodes a persisted session key', () => {
    expect(decodeConcreteConversationId(false, 'agent%3Amain%3Achat')).toBe('agent:main:chat');
  });
});
