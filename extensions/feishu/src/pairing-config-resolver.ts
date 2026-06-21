import type { Config } from '@xopcai/xopc/config/schema.js';
import {
  registerPairingChannelResolver,
  resolveStandardAllowFromPath,
  resolveStandardPairingPath,
} from '@xopcai/xopc/channels/pairing/index.js';

function feishuBlock(config: Config | undefined): Record<string, unknown> | null {
  const ch = config?.channels?.feishu;
  return ch && typeof ch === 'object' && !Array.isArray(ch) ? (ch as Record<string, unknown>) : null;
}

registerPairingChannelResolver('feishu', {
  resolvePaths(accountId) {
    return {
      pairingPath: resolveStandardPairingPath('feishu', accountId),
      allowPath: resolveStandardAllowFromPath('feishu', accountId),
    };
  },
  resolveAccountIds(config) {
    const block = feishuBlock(config);
    const accounts = block?.accounts;
    if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
      const keys = Object.keys(accounts as Record<string, unknown>).sort();
      if (keys.length > 0) return keys;
    }
    const appId = typeof block?.appId === 'string' ? block.appId.trim() : '';
    const appSecret = typeof block?.appSecret === 'string' ? block.appSecret.trim() : '';
    return appId && appSecret ? ['default'] : [];
  },
});
