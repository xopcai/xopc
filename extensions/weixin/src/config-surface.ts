import type { Config } from '@xopcai/xopc/config/index.js';
import type { ChannelConfigSurfaceAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

export const weixinConfigSurface: ChannelConfigSurfaceAdapter = {
  buildConfigSurface(cfg: Config): Record<string, unknown> {
    const weixin = cfg.channels?.weixin as Record<string, unknown> | undefined;
    return {
      enabled: weixin?.enabled ?? false,
      dmPolicy: weixin?.dmPolicy || 'pairing',
      allowFrom: weixin?.allowFrom || [],
      debug: weixin?.debug ?? false,
      streamMode: weixin?.streamMode ?? 'partial',
      historyLimit: weixin?.historyLimit ?? 50,
      textChunkLimit: weixin?.textChunkLimit ?? 4000,
      routeTag: weixin?.routeTag,
      accounts: weixin?.accounts || {},
    };
  },
};
