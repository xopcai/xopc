import { describe, expect, it } from 'vitest';

import { resolveWebchatSessionKey } from '../resolve-webchat-session-key.js';

describe('resolveWebchatSessionKey', () => {
  it('accepts an explicit session key', () => {
    const key = 'agent:main:webchat:default:direct:chat_1';
    const r = resolveWebchatSessionKey({ sessionKey: key });
    expect(r).toEqual({ ok: true, sessionKey: key });
  });

  it('rejects missing session key', () => {
    const r = resolveWebchatSessionKey({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('Missing sessionKey');
    }
  });
});
