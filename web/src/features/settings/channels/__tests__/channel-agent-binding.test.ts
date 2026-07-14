import { describe, expect, it } from 'vitest';

import {
  channelAgentBindingId,
  getChannelAgentBinding,
  mergeChannelAgentBinding,
} from '@/features/settings/channels/channel-agent-binding';

describe('channel-agent-binding', () => {
  it('adds a channel-wide binding without replacing more specific routes', () => {
    const bindings = [
      { id: 'custom', agentId: 'researcher', match: { channel: 'telegram', peerId: '123' } },
      { id: 'ui:route:account:telegram:work', agentId: 'coder', priority: 45, match: { channel: 'telegram', accountId: 'work' } },
      { id: channelAgentBindingId('telegram'), agentId: 'writer', match: { channel: 'telegram', accountId: '*' } },
    ];

    const next = mergeChannelAgentBinding(bindings, 'telegram', 'Creative');

    expect(next).toHaveLength(3);
    expect(next).toContainEqual(bindings[0]);
    expect(next).toContainEqual(bindings[1]);
    expect(next).toContainEqual({
      id: channelAgentBindingId('telegram'),
      agentId: 'creative',
      priority: 40,
      enabled: true,
      match: { channel: 'telegram', accountId: '*' },
    });
  });

  it('removes only its managed binding when reverting to the default agent', () => {
    const bindings = [
      { id: channelAgentBindingId('telegram'), agentId: 'writer', match: { channel: 'telegram', accountId: '*' } },
      { id: 'custom', agentId: 'researcher', match: { channel: 'telegram' } },
    ];

    const next = mergeChannelAgentBinding(bindings, 'telegram', '');

    expect(next).toEqual([bindings[1]]);
  });

  it('reads the selected agent from the managed binding', () => {
    expect(getChannelAgentBinding([
      { id: channelAgentBindingId('Telegram'), agentId: ' Writer ', match: { channel: 'telegram' } },
    ], 'telegram')).toBe('writer');
  });
});
