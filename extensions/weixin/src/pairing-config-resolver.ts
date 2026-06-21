import type { Config } from '@xopcai/xopc/config/schema.js';
import type { DmPolicy } from '@xopcai/xopc/channels/channel-domain.js';
import {
  registerPairingChannelResolver,
  resolveWeixinAllowFromPath,
  resolveWeixinPairingPath,
} from '@xopcai/xopc/channels/pairing/index.js';
import { resolveDmPolicy } from '@xopcai/xopc/channels/security.js';

function weixinBlock(config: Config | undefined): Record<string, unknown> | null {
  const ch = config?.channels?.weixin;
  return ch && typeof ch === 'object' && !Array.isArray(ch) ? (ch as Record<string, unknown>) : null;
}

function account(block: Record<string, unknown> | null, accountId: string): Record<string, unknown> | null {
  const accounts = block?.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return null;
  const acc = (accounts as Record<string, unknown>)[accountId];
  return acc && typeof acc === 'object' && !Array.isArray(acc) ? (acc as Record<string, unknown>) : null;
}

registerPairingChannelResolver('weixin', {
  resolvePaths(accountId) {
    return {
      pairingPath: resolveWeixinPairingPath(accountId),
      allowPath: resolveWeixinAllowFromPath(accountId),
    };
  },
  resolveAllowFromConfig(config, _channel, accountId) {
    const block = weixinBlock(config);
    const top = Array.isArray(block?.allowFrom) ? block.allowFrom.map(String).filter(Boolean) : [];
    const accAllow = account(block, accountId)?.allowFrom;
    const fromAcc = Array.isArray(accAllow) ? accAllow.map(String).filter(Boolean) : [];
    return [...new Set([...top, ...fromAcc])];
  },
  resolveChannelEnabled(config) {
    return weixinBlock(config)?.enabled === true;
  },
  resolveAccountEnabled(config, _channel, accountId) {
    const block = weixinBlock(config);
    if (block?.enabled !== true) return false;
    return account(block, accountId)?.enabled !== false;
  },
  resolveDmPolicy(config, _channel, accountId) {
    const block = weixinBlock(config);
    const accPolicy = account(block, accountId)?.dmPolicy as DmPolicy | undefined;
    return resolveDmPolicy(accPolicy ?? (block?.dmPolicy as DmPolicy | undefined), 'open');
  },
  resolveAccountIds(config) {
    const accounts = weixinBlock(config)?.accounts;
    if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
      const keys = Object.keys(accounts as Record<string, unknown>).sort();
      if (keys.length > 0) return keys;
    }
    return ['default'];
  },
});
