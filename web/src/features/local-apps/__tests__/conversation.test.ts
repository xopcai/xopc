import { describe, expect, it } from 'vitest';

import { localAppConversationUrl } from '@/features/local-apps/conversation';

describe('local app conversation handoff', () => {
  it('builds a skill-aware composer handoff', () => {
    expect(localAppConversationUrl('agent:coder:webchat:abc', 'Add monthly view')).toBe(
      '/chat/agent%3Acoder%3Awebchat%3Aabc?skill=build-xopc-local-app&draft=Add+monthly+view',
    );
  });
});
