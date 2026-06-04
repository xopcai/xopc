import { describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { resolveWebchatSessionKey } from '../resolve-webchat-session-key.js';

const cfg = {
  agents: { default: 'main' },
  session: { mainKey: 'main' },
} as Config;

describe('resolveWebchatSessionKey', () => {
  it('accepts full agent: session key via chatId', () => {
    const key = 'agent:main:webchat:default:direct:chat_1';
    const r = resolveWebchatSessionKey({ cfg, chatId: key });
    expect(r).toEqual({ ok: true, sessionKey: key });
  });

  it('rejects bare chat_* peer id without agent: prefix', () => {
    const r = resolveWebchatSessionKey({ cfg, chatId: 'chat_12345' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('agent:');
    }
  });

  it('defaults empty to agent main bucket', () => {
    const r = resolveWebchatSessionKey({ cfg });
    expect(r).toEqual({ ok: true, sessionKey: 'agent:main:main' });
  });

  it('creates new agent key when newSession=true', () => {
    const r = resolveWebchatSessionKey({ cfg, newSession: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sessionKey).toMatch(/^agent:main:webchat:default:direct:chat_/);
    }
  });
});
