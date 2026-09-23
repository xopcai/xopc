import { requireConversation } from '@xopcai/xopc/storage/sqlite/conversation-repository.js';
import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '@xopcai/xopc/config/schema.js';
import { initializeTestAgentCatalog } from '../../../../src/agent-catalog/test-support.js';
import { generateWeixinConversationIdWithRouting } from '../routing-integration.js';

describe('generateWeixinConversationIdWithRouting', () => {
  const config = ConfigSchema.parse({ session: { dmScope: 'per-account-channel-peer' } });

  it('uses the configured Weixin channel agent binding', () => {
    initializeTestAgentCatalog({
      agents: [{ id: 'main', enabled: true }, { id: 'data-analyst', enabled: true }],
      bindings: [{
        id: 'ui:route:channel:weixin',
        agentId: 'data-analyst',
        priority: 40,
        enabled: true,
        match: { channel: 'weixin', accountId: '*' },
      }],
    });
    expect(requireConversation(
      generateWeixinConversationIdWithRouting(
        { accountId: 'default', senderId: 'user@im.wechat' },
        config,
      ),
    )).toMatchObject({ agentId: 'data-analyst', routing: { source: 'weixin', peerId: 'user@im.wechat' } });
  });
});
