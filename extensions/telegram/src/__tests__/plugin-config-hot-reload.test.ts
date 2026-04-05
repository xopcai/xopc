/**
 * Hot reload: skip Telegram polling restart when channels.telegram is unchanged (avoids 409 from overlapping getUpdates).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageBus } from '@xopcai/xopcbot/infra/bus/index.js';
import type { Config } from '@xopcai/xopcbot/config/schema.js';

import { TelegramChannelPlugin } from '../plugin.js';

function minimalConfig(overrides?: Partial<Config>): Config {
  return {
    channels: {
      telegram: { enabled: true, botToken: '123:TEST_TOKEN' },
      weixin: { enabled: false },
    },
    ...overrides,
  } as Config;
}

describe('TelegramChannelPlugin onConfigUpdated', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('does not stop/start when only another channel subtree changes', async () => {
    const initial = minimalConfig();
    const plugin = new TelegramChannelPlugin();
    await plugin.init({
      bus,
      config: initial,
      channelConfig: initial.channels?.telegram as Record<string, unknown>,
    });

    const stopSpy = vi.spyOn(plugin, 'stop').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(plugin, 'start').mockResolvedValue(undefined);

    const next = {
      ...initial,
      channels: {
        ...initial.channels,
        weixin: { enabled: true, appId: 'wx-changed' },
      },
    } as Config;

    await plugin.onConfigUpdated(next);

    expect(stopSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
    expect((plugin as unknown as { cfg: Config }).cfg).toBe(next);
  });

  it('runs full reapply when channels.telegram changes', async () => {
    const initial = minimalConfig();
    const plugin = new TelegramChannelPlugin();
    await plugin.init({
      bus,
      config: initial,
      channelConfig: initial.channels?.telegram as Record<string, unknown>,
    });

    const stopSpy = vi.spyOn(plugin, 'stop').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(plugin, 'start').mockResolvedValue(undefined);

    const next = {
      ...initial,
      channels: {
        ...initial.channels,
        telegram: { enabled: true, botToken: '999:OTHER_TOKEN' },
      },
    } as Config;

    await plugin.onConfigUpdated(next);

    expect(stopSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalled();
  });
});
