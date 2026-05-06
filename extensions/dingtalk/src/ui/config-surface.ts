import type { ChannelConfigSurfaceAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

export const dingtalkConfigSurface: ChannelConfigSurfaceAdapter = {
  buildConfigSurface: (cfg: Config) => (cfg.channels?.dingtalk as Record<string, unknown>) ?? {},
};
