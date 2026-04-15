import type { Config } from '@xopcai/xopc/config/index.js';
import type { ChannelConfigSurfaceAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

export const telegramConfigSurface: ChannelConfigSurfaceAdapter = {
  buildConfigSurface(cfg: Config): Record<string, unknown> {
    const telegram = cfg.channels?.telegram as Record<string, unknown> | undefined;
    return {
      enabled: telegram?.enabled,
      botToken: telegram?.botToken ? '***' : '',
      allowFrom: telegram?.allowFrom || [],
      groupAllowFrom: telegram?.groupAllowFrom || [],
      apiRoot: telegram?.apiRoot || '',
      debug: telegram?.debug || false,
      dmPolicy: telegram?.dmPolicy || 'pairing',
      groupPolicy: telegram?.groupPolicy || 'open',
      replyToMode: telegram?.replyToMode || 'off',
      streamMode: telegram?.streamMode || 'partial',
      historyLimit: telegram?.historyLimit || 50,
      textChunkLimit: telegram?.textChunkLimit || 4000,
      proxy: telegram?.proxy || '',
      accounts: telegram?.accounts || {},
    };
  },
};
