import { describe, it, expect, vi } from 'vitest';
import {
  normalizeWeixinCronDeliveryTo,
  normalizeWeixinCronDeliveryToResolved,
  resolveWeixinAccountIdFromSessions,
} from '../weixin-delivery-to.js';

describe('normalizeWeixinCronDeliveryTo', () => {
  it('passes through plain ilink peer id', () => {
    expect(normalizeWeixinCronDeliveryTo('o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat')).toEqual({
      chatId: 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
    });
  });

  it('parses shorthand accountId:dm:peer (gateway / cron UI)', () => {
    expect(
      normalizeWeixinCronDeliveryTo(
        'e948216a701a-im-bot:dm:o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
      ),
    ).toEqual({
      chatId: 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
      accountId: 'e948216a701a-im-bot',
    });
  });

  it('strips full weixin session key to peer id and accountId', () => {
    expect(
      normalizeWeixinCronDeliveryTo(
        'main:weixin:e948216a701a-im-bot:dm:o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
      ),
    ).toEqual({
      chatId: 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat',
      accountId: 'e948216a701a-im-bot',
    });
  });
});

describe('resolveWeixinAccountIdFromSessions', () => {
  it('returns accountId when exactly one weixin session matches peerId', async () => {
    const peer = 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat';
    const store = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            key: `main:weixin:e948216a701a-im-bot:dm:${peer}`,
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
    const peer = 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat';
    const store = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            key: `main:weixin:acc-a:dm:${peer}`,
            sourceChannel: 'weixin',
            routing: { accountId: 'acc-a', peerId: peer, source: 'weixin', agentId: 'm', peerKind: 'dm' },
          },
          {
            key: `main:weixin:acc-b:dm:${peer}`,
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
    const peer = 'o9cq80xmyaah0gi4cogkdxdf_0bq-im-wechat';
    const store = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            key: `main:weixin:e948216a701a-im-bot:dm:${peer}`,
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
