import { requireConversation } from '@xopcai/xopc/storage/sqlite/conversation-repository.js';
import { describe, expect, it } from 'vitest';

import type { Config } from '@xopcai/xopc/config/schema.js';
import { generateWeixinConversationIdWithRouting } from '../routing-integration.js';

describe('generateWeixinConversationIdWithRouting', () => {
  const config: Config = {
    agents: {
      default: 'main',
      list: [{ id: 'main' }, { id: 'data-analyst' }],
    },
    bindings: [
      {
        id: 'ui:route:channel:weixin',
        agentId: 'data-analyst',
        priority: 40,
        enabled: true,
        match: { channel: 'weixin', accountId: '*' },
      },
    ],
    session: { dmScope: 'per-account-channel-peer' },
  };

  it('uses the configured Weixin channel agent binding', () => {
    expect(requireConversation(
      generateWeixinConversationIdWithRouting(
        { accountId: 'default', senderId: 'user@im.wechat' },
        config,
      ),
    )).toMatchObject({ agentId: 'data-analyst', routing: { source: 'weixin', peerId: 'user@im.wechat' } });
  });
});
