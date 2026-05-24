import { describe, expect, it, vi } from 'vitest';

import { MessageBus } from '../../infra/bus/index.js';
import { ChannelManager } from '../../channels/manager.js';
import type { Config } from '../../config/schema.js';
import { resolveChannelConnectDeferSet } from '../resolve-channel-connect-defer.js';

function baseCfg(over: Partial<Config['gateway']> = {}): Config {
  return {
    gateway: {
      bind: 'loopback',
      port: 18790,
      ...over,
    },
  } as Config;
}

describe('resolveChannelConnectDeferSet', () => {
  it('returns empty when HTTP lifecycle defer is off', () => {
    const bus = new MessageBus();
    const cm = new ChannelManager(baseCfg(), bus);
    const r = resolveChannelConnectDeferSet({
      config: baseCfg(),
      channelManager: cm,
      deferChannelConnectUntilAfterHttp: false,
    });
    expect([...r.deferPluginIds]).toEqual([]);
    expect(r.source).toBe('off');
  });

  it('mode off clears defer set even when HTTP defer is on', () => {
    const bus = new MessageBus();
    const cm = new ChannelManager(baseCfg({ channelConnectDeferMode: 'off' }), bus);
    vi.spyOn(cm, 'listDeferConnectChannelIds').mockReturnValue(['telegram']);
    const r = resolveChannelConnectDeferSet({
      config: baseCfg({ channelConnectDeferMode: 'off' }),
      channelManager: cm,
      deferChannelConnectUntilAfterHttp: true,
    });
    expect([...r.deferPluginIds]).toEqual([]);
    expect(r.mode).toBe('off');
    expect(r.source).toBe('off');
  });

  it('explicit mode uses channelConnectDeferIds minus skip', () => {
    const bus = new MessageBus();
    const cm = new ChannelManager(
      baseCfg({
        channelConnectDeferMode: 'explicit',
        channelConnectDeferIds: ['telegram', 'weixin'],
        channelConnectDeferSkipIds: ['weixin'],
      }),
      bus,
    );
    const r = resolveChannelConnectDeferSet({
      config: baseCfg({
        channelConnectDeferMode: 'explicit',
        channelConnectDeferIds: ['telegram', 'weixin'],
        channelConnectDeferSkipIds: ['weixin'],
      }),
      channelManager: cm,
      deferChannelConnectUntilAfterHttp: true,
    });
    expect([...r.deferPluginIds].sort()).toEqual(['telegram']);
    expect(r.mode).toBe('explicit');
    expect(r.source).toBe('explicit');
  });

  it('auto mode uses listDeferConnectChannelIds minus skip', () => {
    const bus = new MessageBus();
    const cm = new ChannelManager(baseCfg({ channelConnectDeferSkipIds: ['telegram'] }), bus);
    vi.spyOn(cm, 'listDeferConnectChannelIds').mockReturnValue(['telegram', 'feishu']);
    const r = resolveChannelConnectDeferSet({
      config: baseCfg({ channelConnectDeferSkipIds: ['telegram'] }),
      channelManager: cm,
      deferChannelConnectUntilAfterHttp: true,
    });
    expect([...r.deferPluginIds]).toEqual(['feishu']);
    expect(r.mode).toBe('auto');
    expect(r.source).toBe('meta');
  });
});
