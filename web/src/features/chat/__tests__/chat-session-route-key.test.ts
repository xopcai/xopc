import { describe, expect, it } from 'vitest';

import { decodeConcreteSessionKey } from '../session/chat-session-view';

describe('decodeConcreteSessionKey', () => {
  it('does not expose the /chat/new placeholder as a session key', () => {
    expect(decodeConcreteSessionKey(true, 'new')).toBeUndefined();
  });

  it('decodes a persisted session key', () => {
    expect(decodeConcreteSessionKey(false, 'agent%3Amain%3Achat')).toBe('agent:main:chat');
  });
});
