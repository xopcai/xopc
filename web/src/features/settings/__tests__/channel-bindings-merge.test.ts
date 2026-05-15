import { describe, expect, it } from 'vitest';

import {
  extractChannelAgentRoutes,
  mergeChannelAgentBindings,
  type BindingRuleWire,
} from '@/features/settings/channel-bindings-merge';

describe('channel-bindings-merge', () => {
  it('extractChannelAgentRoutes maps telegram, weixin, and feishu account rules', () => {
    const bindings: BindingRuleWire[] = [
      { agentId: 'Alpha', match: { channel: 'telegram', accountId: 'acc1' } },
      { agentId: 'Beta', match: { channel: 'weixin', accountId: 'wx1' } },
      { agentId: 'Gamma', match: { channel: 'feishu', accountId: 'fs1' } },
    ];
    const r = extractChannelAgentRoutes(bindings, ['acc1'], ['wx1'], ['fs1'], 'main');
    expect(r.telegram.acc1).toBe('alpha');
    expect(r.weixin.wx1).toBe('beta');
    expect(r.feishu.fs1).toBe('gamma');
  });

  it('extractChannelAgentRoutes falls back to defaultAgentId', () => {
    const r = extractChannelAgentRoutes([], ['t1'], ['w1'], ['f1'], 'DEFAULT');
    expect(r.telegram.t1).toBe('default');
    expect(r.weixin.w1).toBe('default');
    expect(r.feishu.f1).toBe('default');
  });

  it('mergeChannelAgentBindings replaces managed ui:route rules and preserves other bindings', () => {
    const previous: BindingRuleWire[] = [
      { id: 'ui:route:account:telegram:old', agentId: 'x', match: { channel: 'telegram', accountId: 'old' } },
      { id: 'keep-me', agentId: 'z', match: { channel: 'slack', accountId: 's1' } },
    ];
    const next = mergeChannelAgentBindings(
      previous,
      { telegram: { a1: 'agent1' }, weixin: {}, feishu: {} },
      ['a1'],
      [],
      [],
      'main',
    );
    const slack = next.find((b) => b.id === 'keep-me');
    expect(slack?.agentId).toBe('z');
    const tg = next.find((b) => b.id === 'ui:route:account:telegram:a1');
    expect(tg?.agentId).toBe('agent1');
    expect(next.some((b) => b.id === 'ui:route:account:telegram:old')).toBe(false);
  });
});
