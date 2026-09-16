import { describe, expect, it } from 'vitest';

import { resolveWebchatConversationId } from '../resolve-webchat-session-key.js';

describe('resolveWebchatConversationId', () => {
  it('accepts an explicit session key', () => {
    const key = 'agent:main:webchat:default:direct:chat_1';
    const r = resolveWebchatConversationId({ conversationId: key });
    expect(r).toEqual({ ok: true, conversationId: key });
  });

  it('rejects missing session key', () => {
    const r = resolveWebchatConversationId({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('Missing conversationId');
    }
  });
});
