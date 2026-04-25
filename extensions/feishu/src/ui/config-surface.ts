import type { ChannelConfigSurfaceAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

export const feishuConfigSurface: ChannelConfigSurfaceAdapter = {
  // Note: unlike providers (which intentionally return masked values),
  // channel config is returned as plain text in /api/config so the Web UI can
  // render it like Telegram: hidden by default, reveal on demand.
  buildConfigSurface: (cfg: Config) => (cfg.channels?.feishu as Record<string, unknown>) ?? {},
};

