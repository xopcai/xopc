import type { Config } from '@xopcai/xopc/config/index.js';
import type { ChannelConfigSurfaceAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

export const telegramConfigSurface: ChannelConfigSurfaceAdapter = {
  buildConfigSurface(cfg: Config): Record<string, unknown> {
    const telegram = cfg.channels?.telegram as Record<string, unknown> | undefined;
    const accounts = telegram?.accounts as Record<string, { botToken?: string }> | undefined;
    const defTok =
      accounts?.default && typeof accounts.default === 'object'
        ? accounts.default.botToken
        : undefined;
    return {
      enabled: telegram?.enabled,
      // Send the real token to the authenticated settings UI.
      // The web UI is responsible for masking it by default.
      botToken: typeof defTok === 'string' ? defTok : '',
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
