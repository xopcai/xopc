import { describe, expect, it } from 'vitest';

import type { Config } from '@xopcai/xopc/config/schema.js';
import { generateWeixinSessionKeyWithRouting } from '../routing-integration.js';

describe('generateWeixinSessionKeyWithRouting', () => {
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
    expect(
      generateWeixinSessionKeyWithRouting(
        { accountId: 'default', senderId: 'user@im.wechat' },
        config,
      ),
    ).toBe('agent:data-analyst:weixin:default:direct:user@im.wechat');
  });
});
