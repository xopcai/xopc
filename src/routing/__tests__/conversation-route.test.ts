import { describe, expect, it } from 'vitest';

import { conversationIdSchema } from '../../../packages/gateway-contract/src/conversation-identity.js';
import { conversationRouteKey, resolveConversationRoute, type DirectConversationScope } from '../conversation-route.js';

const input = { agentId: 'coder', source: 'telegram', accountId: 'first', peerKind: 'direct', peerId: 'Alice' };
const key = (changes: Partial<Parameters<typeof resolveConversationRoute>[0]> = {}) =>
  conversationRouteKey(resolveConversationRoute({ ...input, ...changes }));

describe('conversation identity and routing', () => {
  it('accepts UUID identity and rejects encoded routing keys', () => {
    expect(conversationIdSchema.safeParse('agent:coder:main').success).toBe(false);
    expect(conversationIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(conversationIdSchema.parse('9A371150-1EAA-4218-8EBB-C37FDF81A3F6')).toBe('9a371150-1eaa-4218-8ebb-c37fdf81a3f6');
  });

  it.each<DirectConversationScope>(['main', 'per-peer', 'per-channel-peer', 'per-account-channel-peer'])('preserves %s isolation', dmScope => {
    const base = key({ dmScope });
    expect(key({ dmScope, agentId: 'other' })).not.toBe(base);
    expect(key({ dmScope, peerId: 'bob' }) === base).toBe(dmScope === 'main');
    expect(key({ dmScope, source: 'weixin' }) === base).toBe(dmScope === 'main' || dmScope === 'per-peer');
    expect(key({ dmScope, accountId: 'second' }) === base).toBe(dmScope !== 'per-account-channel-peer');
  });

  it('merges linked peers only within the requested scope', () => {
    const identityLinks = { owner: ['telegram:alice', 'weixin:bob'] };
    expect(key({ dmScope: 'per-peer', identityLinks })).toBe(key({ dmScope: 'per-peer', identityLinks, source: 'weixin', peerId: 'bob' }));
    expect(key({ identityLinks })).not.toBe(key({ identityLinks, source: 'weixin', peerId: 'bob' }));
  });

  it('preserves group account equivalence and separates topics and scopes', () => {
    const base = key({ peerKind: 'group' });
    expect(key({ peerKind: 'group', accountId: 'second' })).toBe(base);
    expect(key({ peerKind: 'group', threadId: 'topic' })).not.toBe(base);
    expect(key({ peerKind: 'group', scopeId: 'workflow' })).not.toBe(base);
    expect(key({ peerKind: 'group', identityLinks: { owner: ['alice'] } })).toBe(base);
  });

  it('does not collapse separators across tuple dimensions', () => {
    expect(key({ peerId: 'a:thread:b' })).not.toBe(key({ peerId: 'a', threadId: 'b' }));
    expect(key({ peerId: ' ALICE ' })).toBe(key());
  });

  it('requires an explicit agent and peer instead of selecting main', () => {
    expect(() => key({ agentId: '' })).toThrow('agent');
    expect(() => key({ peerId: '' })).toThrow('peer');
  });
});
