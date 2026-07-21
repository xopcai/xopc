import { describe, expect, it } from 'vitest';

import { localAppConversationUrl, selectLocalAppCoderSession } from '@/features/local-apps/conversation';

describe('local app conversation handoff', () => {
  it('reuses the first coder session in project order', () => {
    const selected = selectLocalAppCoderSession([
      { key: 'main-session', agentId: 'main' },
      { key: 'coder-session', routing: { agentId: 'coder' } },
      { key: 'older-coder-session', agentId: 'coder' },
    ]);
    expect(selected?.key).toBe('coder-session');
  });

  it('builds a skill-aware composer handoff', () => {
    expect(localAppConversationUrl('agent:coder:webchat:abc', 'Add monthly view')).toBe(
      '/chat/agent%3Acoder%3Awebchat%3Aabc?skill=build-xopc-local-app&draft=Add+monthly+view',
    );
  });
});
