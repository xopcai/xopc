import type { ChannelConfigSurfaceAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import type { Config } from '@xopcai/xopc/config/schema.js';

function redactSection(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  if (typeof o.appSecret === 'string' && o.appSecret.trim()) o.appSecret = '***';
  if (o.accounts && typeof o.accounts === 'object' && !Array.isArray(o.accounts)) {
    const accounts = { ...(o.accounts as Record<string, unknown>) };
    for (const [k, v] of Object.entries(accounts)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const a = { ...(v as Record<string, unknown>) };
      if (typeof a.appSecret === 'string' && a.appSecret.trim()) a.appSecret = '***';
      accounts[k] = a;
    }
    o.accounts = accounts;
  }
  return o;
}

export const feishuConfigSurface: ChannelConfigSurfaceAdapter = {
  buildConfigSurface: (cfg: Config) => redactSection(cfg.channels?.feishu) as Record<string, unknown>,
};

