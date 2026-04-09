/**
 * Root `botToken` + empty `accounts: {}` must still register the default account (JSON often omits keys vs {}).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBus } from '@xopcai/xopcbot/infra/bus/index.js';
import type { Config } from '@xopcai/xopcbot/config/schema.js';

import { TelegramChannelPlugin } from '../plugin.js';

function baseTelegramConfig(): NonNullable<Config['channels']>['telegram'] {
  return {
    enabled: true,
    botToken: '123456:TEST_TOKEN',
    accounts: {},
    dmPolicy: 'open',
    groupPolicy: 'open',
  } as NonNullable<Config['channels']>['telegram'];
}

describe('TelegramChannelPlugin loadAccounts', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('registers default account when accounts is an empty object', async () => {
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
          botToken: '123456:TEST_TOKEN',
          accounts: {},
          dmPolicy: 'open',
          groupPolicy: 'open',
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
});
