import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { MessageBus } from '../../infra/bus/index.js';
import type { ChannelPlugin } from '../plugin-types.js';
import { ChannelManager } from '../manager.js';

function minimalConfig(): Config {
  return {
    channels: {
      telegram: { enabled: true, accounts: { a: { accountId: 'a', enabled: true, botToken: 't' } } },
    },
  } as unknown as Config;
}

describe('ChannelManager deferred connect', () => {
  it('skips start for deferred ids then startDeferredConnects runs them', async () => {
    const bus = new MessageBus();
    const cfg = minimalConfig();
    const manager = new ChannelManager(cfg, bus);

    const startSpy = vi.fn().mockResolvedValue(undefined);
    const initSpy = vi.fn().mockResolvedValue(undefined);

    const plugin: ChannelPlugin = {
      id: 'telegram',
      meta: {
        id: 'telegram',
        label: 'T',
        selectionLabel: 'T',
        docsPath: '/x',
        blurb: 'x',
        deferConnectUntilAfterListen: true,
      },
      capabilities: {
        chatTypes: ['direct'],
        reactions: false,
        threads: false,
        media: false,
        nativeCommands: false,
        blockStreaming: false,
      },
      config: {
        listAccountIds: () => ['a'],
        resolveAccount: () => ({ accountId: 'a', enabled: true, botToken: 't' }),
      },
      init: initSpy,
      start: startSpy,
      stop: vi.fn().mockResolvedValue(undefined),
    };

    manager.registerPlugin(plugin);
    await manager.initialize();
    await manager.start({ deferConnectPluginIds: new Set(['telegram']) });

    expect(startSpy).not.toHaveBeenCalled();

    await manager.startDeferredConnects();
    expect(startSpy).toHaveBeenCalledTimes(1);
  });
});
