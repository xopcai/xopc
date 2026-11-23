import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { inspectSelfConfig } from '../../self-config/inspect.js';
import { resolveDefaultCrossChannelTarget } from '../outbound-targets.js';
import { inspectWeixinChannelState, listDeliverableWeixinTargets } from '../weixin/outbound-targets.js';
import { clearContextTokensForAccount } from '../../../extensions/weixin/src/messaging/inbound.js';

describe('cross-channel default outbound targets', () => {
  const prevStateDir = process.env.XOPC_STATE_DIR;
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xopc-outbound-targets-'));
    process.env.XOPC_STATE_DIR = tempDir;
    clearContextTokensForAccount('bot-a');
    clearContextTokensForAccount('bot-b');
  });

  afterEach(() => {
    clearContextTokensForAccount('bot-a');
    clearContextTokensForAccount('bot-b');
    if (prevStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = prevStateDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeWeixinAccount(accountId: string, token: string, contextTokens?: Record<string, unknown>) {
    const accountsDir = path.join(tempDir, 'weixin', 'accounts');
    fs.mkdirSync(accountsDir, { recursive: true });
    fs.writeFileSync(
      path.join(accountsDir, `${accountId}.json`),
      JSON.stringify({ token, baseUrl: 'https://ilinkai.weixin.qq.com' }),
      'utf-8',
    );
    if (contextTokens) {
      fs.writeFileSync(
        path.join(accountsDir, `${accountId}.context-tokens.json`),
        JSON.stringify(contextTokens),
        'utf-8',
      );
    }
  }

  it('resolves the single allowed Weixin recipient from disk context tokens without exposing secrets', async () => {
    writeWeixinAccount('bot-a', 'SECRET_WEIXIN_BOT_TOKEN', {
      'alice-im-wechat': { token: 'SECRET_CONTEXT_TOKEN_1', sendTo: 'Alice@im.wechat' },
      'blocked-im-wechat': { token: 'SECRET_CONTEXT_TOKEN_2', sendTo: 'Blocked@im.wechat' },
    });

    const config = ConfigSchema.parse({
      channels: {
        weixin: {
          enabled: true,
          accounts: {
            'bot-a': {
              enabled: true,
              dmPolicy: 'allowlist',
              allowFrom: ['Alice@im.wechat'],
            },
          },
        },
      },
    });

    const targets = listDeliverableWeixinTargets(config);
    expect(targets).toEqual([{ accountId: 'bot-a', chatId: 'Alice@im.wechat' }]);

    const resolved = await resolveDefaultCrossChannelTarget({ channel: 'weixin', config });
    expect(resolved).toEqual({
      ok: true,
      channel: 'weixin',
      accountId: 'bot-a',
      chatId: 'Alice@im.wechat',
    });

    const inspected = await inspectSelfConfig(config, { domain: 'channels' });
    const serialized = JSON.stringify(inspected);
    expect(serialized).not.toContain('SECRET_WEIXIN_BOT_TOKEN');
    expect(serialized).not.toContain('SECRET_CONTEXT_TOKEN_1');
    const channels = inspected.domains.find((d) => d.domain === 'channels');
    expect(channels?.ready).toBe(true);
    expect(channels?.details).toMatchObject({
      weixin: {
        enabled: true,
        accountCount: 1,
        configuredAccountCount: 1,
        hasCredential: true,
        dmPolicy: 'allowlist',
        deliverableRecipientCount: 1,
      },
    });
  });

  it('reports ambiguity when multiple allowed Weixin recipients have cached context tokens', async () => {
    writeWeixinAccount('bot-a', 'TOKEN_A', {
      'alice-im-wechat': { token: 'CTX_A', sendTo: 'Alice@im.wechat' },
      'bob-im-wechat': { token: 'CTX_B', sendTo: 'Bob@im.wechat' },
    });

    const config = ConfigSchema.parse({
      channels: {
        weixin: {
          enabled: true,
          accounts: {
            'bot-a': { enabled: true, dmPolicy: 'open' },
          },
        },
      },
    });

    const resolved = await resolveDefaultCrossChannelTarget({ channel: 'weixin', config });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toBe('ambiguous');
      expect(resolved.candidates).toHaveLength(2);
      expect(resolved.message).toContain('Alice@im.wechat');
      expect(resolved.message).toContain('Bob@im.wechat');
    }
  });

  it('reports not_configured when Weixin is enabled without a logged-in credential on disk', async () => {
    const config = ConfigSchema.parse({
      channels: {
        weixin: {
          enabled: true,
          accounts: {
            'bot-a': { enabled: true, dmPolicy: 'allowlist', allowFrom: ['Alice@im.wechat'] },
          },
        },
      },
    });

    expect(inspectWeixinChannelState(config)).toMatchObject({
      enabled: true,
      hasCredential: false,
      deliverableRecipientCount: 0,
    });

    const resolved = await resolveDefaultCrossChannelTarget({ channel: 'weixin', config });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toBe('not_configured');
    }

    const inspected = await inspectSelfConfig(config, { domain: 'channels' });
    const channels = inspected.domains.find((d) => d.domain === 'channels');
    expect(channels?.ready).toBe(false);
    expect(channels?.blockers).toContain('Weixin is enabled without a logged-in account.');
  });

  it('reports no_recipient when Weixin is logged in but no user has messaged the bot yet', async () => {
    writeWeixinAccount('bot-a', 'TOKEN_A');

    const config = ConfigSchema.parse({
      channels: {
        weixin: {
          enabled: true,
          accounts: {
            'bot-a': { enabled: true, dmPolicy: 'allowlist', allowFrom: ['Alice@im.wechat'] },
          },
        },
      },
    });

    const resolved = await resolveDefaultCrossChannelTarget({ channel: 'weixin', config });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toBe('no_recipient');
      expect(resolved.message).toContain('context_token');
    }
  });

  it('resolves a single recent direct-message peer for other channels via sessionStore', async () => {
    const config = ConfigSchema.parse({
      channels: {
        telegram: { enabled: true, botToken: 'tg-token' },
      },
    });
    const sessionStore = {
      list: async () => ({
        items: [
          {
            key: 'conv-1',
            routing: {
              agentId: 'main',
              source: 'telegram',
              accountId: 'personal',
              peerKind: 'direct' as const,
              peerId: '123456789',
            },
          },
        ],
        total: 1,
        hasMore: false,
      }),
    };

    const resolved = await resolveDefaultCrossChannelTarget({
      channel: 'telegram',
      config,
      sessionStore: sessionStore as never,
    });
    expect(resolved).toEqual({
      ok: true,
      channel: 'telegram',
      chatId: '123456789',
      accountId: 'personal',
    });
  });
});
