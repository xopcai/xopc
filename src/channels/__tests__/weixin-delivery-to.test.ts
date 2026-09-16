import { requireXopcDatabase as openFixtureDatabase } from '../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("258d3cb7-e3ad-49e4-865e-955292dbf69f", '', {"agentId":"main","sourceChannel":"weixin","sourceChatId":"o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat","sessionType":"chat","routing":{"agentId":"main","source":"weixin","accountId":"e948216a701a-im-bot","peerKind":"direct","peerId":"o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat"}});
}
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeWeixinCronDeliveryTo,
  normalizeWeixinCronDeliveryToResolved,
  resolveWeixinAccountIdFromSessions,
} from '../weixin/index.js';

describe('normalizeWeixinCronDeliveryTo', () => {
  it('passes through plain ilink peer id', () => {
    seedConversationFixtures();
    expect(normalizeWeixinCronDeliveryTo('o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat')).toEqual({
      chatId: 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
    });
  });

  it('parses shorthand accountId:direct:peer (gateway / cron UI)', () => {
    seedConversationFixtures();
    expect(
      normalizeWeixinCronDeliveryTo(
        'e948216a701a-im-bot:direct:o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
      ),
    ).toEqual({
      chatId: 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
      accountId: 'e948216a701a-im-bot',
    });
  });

  it('strips full weixin session key to peer id and accountId', () => {
    seedConversationFixtures();
    expect(
      normalizeWeixinCronDeliveryTo(
        "258d3cb7-e3ad-49e4-865e-955292dbf69f",
      ),
    ).toEqual({
      chatId: 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
      accountId: 'e948216a701a-im-bot',
    });
  });
});

describe('resolveWeixinAccountIdFromSessions', () => {
  it('returns accountId when exactly one weixin session matches peerId', async () => {
    seedConversationFixtures();
    const peer = 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat';
    const store = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            key: `agent:main:weixin:e948216a701a-im-bot:direct:${peer}`,
            sourceChannel: 'weixin',
            routing: {
              agentId: 'main',
              source: 'weixin',
              accountId: 'e948216a701a-im-bot',
              peerKind: 'dm',
              peerId: peer,
            },
          },
        ],
        hasMore: false,
        total: 1,
        limit: 2000,
        offset: 0,
      }),
    };
    await expect(resolveWeixinAccountIdFromSessions(store as any, peer)).resolves.toBe(
      'e948216a701a-im-bot',
    );
  });

  it('returns undefined when multiple accounts share the same peerId', async () => {
    seedConversationFixtures();
    const peer = 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat';
    const store = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            key: `agent:main:weixin:acc-a:direct:${peer}`,
            sourceChannel: 'weixin',
            routing: { accountId: 'acc-a', peerId: peer, source: 'weixin', agentId: 'm', peerKind: 'dm' },
          },
          {
            key: `agent:main:weixin:acc-b:direct:${peer}`,
            sourceChannel: 'weixin',
            routing: { accountId: 'acc-b', peerId: peer, source: 'weixin', agentId: 'm', peerKind: 'dm' },
          },
        ],
        hasMore: false,
        total: 2,
        limit: 2000,
        offset: 0,
      }),
    };
    await expect(resolveWeixinAccountIdFromSessions(store as any, peer)).resolves.toBeUndefined();
  });
});

describe('normalizeWeixinCronDeliveryToResolved', () => {
  it('fills accountId from session store for bare ilink id', async () => {
    seedConversationFixtures();
    const peer = 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat';
    const store = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            key: `agent:main:weixin:e948216a701a-im-bot:direct:${peer}`,
            sourceChannel: 'weixin',
            routing: {
              agentId: 'main',
              source: 'weixin',
              accountId: 'e948216a701a-im-bot',
              peerKind: 'dm',
              peerId: peer,
            },
          },
        ],
        hasMore: false,
        total: 1,
        limit: 2000,
        offset: 0,
      }),
    };
    await expect(normalizeWeixinCronDeliveryToResolved(peer, store as any)).resolves.toEqual({
      chatId: peer,
      accountId: 'e948216a701a-im-bot',
    });
  });
});
