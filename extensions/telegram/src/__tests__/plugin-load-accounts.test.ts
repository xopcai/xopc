/**
 * Token lives under `accounts.<id>.botToken` (typically `default`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

import { TelegramChannelPlugin } from '../plugin.js';

function baseTelegramConfig(): NonNullable<Config['channels']>['telegram'] {
  return {
    enabled: true,
    accounts: {
      default: {
        accountId: 'default',
        enabled: true,
        botToken: '123456:TEST_TOKEN',
      },
    },
    defaults: {
      dmPolicy: 'pairing',
      groupPolicy: 'open',
      replyToMode: 'off',
      historyLimit: 50,
      textChunkLimit: 4000,
      streaming: { mode: 'partial' },
    },
  } as NonNullable<Config['channels']>['telegram'];
}

describe('TelegramChannelPlugin loadAccounts', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('registers default account from accounts.default.botToken', async () => {
    const cfg = {
      channels: {
        telegram: baseTelegramConfig(),
      },
    } as Config;

    const plugin = new TelegramChannelPlugin();
    await plugin.init({
      bus,
      config: cfg,
      channelConfig: cfg.channels?.telegram as Record<string, unknown>,
    });

    expect(plugin.config.listAccountIds(cfg)).toEqual(['default']);
    const acc = plugin.config.resolveAccount(cfg, 'default');
    expect(acc.botToken).toBe('123456:TEST_TOKEN');
    expect(acc.enabled).toBe(true);
  });

  it('inherits account policies from channels.telegram.defaults', async () => {
    const cfg = {
      channels: {
        telegram: {
          ...baseTelegramConfig(),
          defaults: {
            ...baseTelegramConfig().defaults,
            dmPolicy: 'allowlist',
            streaming: { mode: 'block' },
          },
        },
      },
    } as Config;

    const plugin = new TelegramChannelPlugin();
    await plugin.init({
      bus,
      config: cfg,
      channelConfig: cfg.channels?.telegram as Record<string, unknown>,
    });

    const acc = plugin.config.resolveAccount(cfg, 'default');
    expect(acc.dmPolicy).toBe('allowlist');
    expect(acc.streaming?.mode).toBe('block');
  });

  it('uses named accounts when accounts is non-empty', async () => {
    const cfg = {
      channels: {
        telegram: {
          ...baseTelegramConfig(),
          accounts: {
            work: { enabled: true, botToken: '999:OTHER', dmPolicy: 'open', groupPolicy: 'open' },
          },
        },
      },
    } as Config;

    const plugin = new TelegramChannelPlugin();
    await plugin.init({
      bus,
      config: cfg,
      channelConfig: cfg.channels?.telegram as Record<string, unknown>,
    });

    expect(plugin.config.listAccountIds(cfg).sort()).toEqual(['work']);
  });

  it('does not register accounts when channel.enabled is false', async () => {
    const cfg = {
      channels: {
        telegram: {
          enabled: false,
          accounts: {
            default: {
              accountId: 'default',
              enabled: true,
              botToken: '123456:TEST_TOKEN',
            },
          },
          defaults: baseTelegramConfig().defaults,
        },
      },
    } as Config;

    const plugin = new TelegramChannelPlugin();
    await plugin.init({
      bus,
      config: cfg,
      channelConfig: cfg.channels?.telegram as Record<string, unknown>,
    });

    expect(plugin.config.listAccountIds(cfg)).toEqual([]);
  });

  it('inherits channels.telegram.defaults.apiRoot into each account when account omits apiRoot', async () => {
    const cfg = {
      channels: {
        telegram: {
          ...baseTelegramConfig(),
          defaults: {
            ...baseTelegramConfig().defaults,
            apiRoot: 'https://tg.xopc.ai/',
          },
        },
      },
    } as Config;

    const plugin = new TelegramChannelPlugin();
    await plugin.init({
      bus,
      config: cfg,
      channelConfig: cfg.channels?.telegram as Record<string, unknown>,
    });

    const acc = plugin.config.resolveAccount(cfg, 'default');
    expect(acc.apiRoot).toBe('https://tg.xopc.ai');
  });

  it('keeps per-account apiRoot over defaults apiRoot', async () => {
    const cfg = {
      channels: {
        telegram: {
          ...baseTelegramConfig(),
          defaults: {
            ...baseTelegramConfig().defaults,
            apiRoot: 'https://tg.xopc.ai',
          },
          accounts: {
            default: {
              ...baseTelegramConfig().accounts!.default,
              apiRoot: 'https://api.telegram.org',
            },
          },
        },
      },
    } as Config;

    const plugin = new TelegramChannelPlugin();
    await plugin.init({
      bus,
      config: cfg,
      channelConfig: cfg.channels?.telegram as Record<string, unknown>,
    });

    expect(plugin.config.resolveAccount(cfg, 'default').apiRoot).toBe('https://api.telegram.org');
  });
});
