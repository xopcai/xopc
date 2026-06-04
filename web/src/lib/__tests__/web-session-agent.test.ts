import { describe, expect, it } from 'vitest';

import { getAgentIdFromWebSessionKey } from '@/lib/web-session-agent';

describe('getAgentIdFromWebSessionKey', () => {
  it('parses standard webchat keys', () => {
    expect(getAgentIdFromWebSessionKey('agent:main:webchat:default:direct:chat_1')).toBe('main');
    expect(getAgentIdFromWebSessionKey('agent:coder:webchat:default:direct:chat_2')).toBe('coder');
  });

  it('parses main bucket keys', () => {
    expect(getAgentIdFromWebSessionKey('agent:main:main')).toBe('main');
    expect(getAgentIdFromWebSessionKey('agent:coder:main')).toBe('coder');
  });

  it('parses channel session keys', () => {
    expect(getAgentIdFromWebSessionKey('agent:coder:telegram:default:direct:123456')).toBe('coder');
    expect(getAgentIdFromWebSessionKey('agent:main:telegram:group:-100123456')).toBe('main');
  });

  it('returns null for invalid keys', () => {
    expect(getAgentIdFromWebSessionKey('')).toBeNull();
    expect(getAgentIdFromWebSessionKey('too:short')).toBeNull();
    expect(getAgentIdFromWebSessionKey('main:webchat:default:direct:chat_1')).toBeNull();
  });
});
