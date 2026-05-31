import { describe, expect, it } from 'vitest';

import { getAgentIdFromWebSessionKey } from '@/lib/web-session-agent';

describe('getAgentIdFromWebSessionKey', () => {
  it('parses standard webchat keys', () => {
    expect(getAgentIdFromWebSessionKey('main:webchat:default:direct:chat_1')).toBe('main');
    expect(getAgentIdFromWebSessionKey('coder:webchat:default:direct:chat_2')).toBe('coder');
  });

  it('parses legacy gateway-prefixed keys', () => {
    expect(getAgentIdFromWebSessionKey('gateway:main:webchat:default:direct:chat_1')).toBe('main');
    expect(getAgentIdFromWebSessionKey('gateway:coder:webchat:default:direct:chat_2')).toBe('coder');
  });

  it('parses channel session keys (agent is first segment)', () => {
    expect(getAgentIdFromWebSessionKey('coder:telegram:acc_default:dm:123456')).toBe('coder');
  });

  it('returns null for invalid keys', () => {
    expect(getAgentIdFromWebSessionKey('')).toBeNull();
    expect(getAgentIdFromWebSessionKey('too:short')).toBeNull();
  });
});
