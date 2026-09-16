import { describe, expect, it } from 'vitest';

import { canStartChatBootstrap } from '../chat-bootstrap-gate';

const ready = {
  gatewayReady: true,
  gatewayOnline: true,
  urlConversationId: '',
  alreadyAttempted: false,
};

describe('chat bootstrap gate', () => {
  it('waits until the active gateway has been restored on app startup', () => {
    expect(canStartChatBootstrap({ ...ready, gatewayReady: false })).toBe(false);
    expect(canStartChatBootstrap(ready)).toBe(true);
  });

  it('does not start while another bootstrap condition is unresolved', () => {
    expect(canStartChatBootstrap({ ...ready, gatewayOnline: false })).toBe(false);
    expect(canStartChatBootstrap({ ...ready, urlConversationId: 'agent:main:webchat:existing' })).toBe(false);
    expect(canStartChatBootstrap({ ...ready, alreadyAttempted: true })).toBe(false);
  });
});
