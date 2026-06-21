import type { Config } from '@xopcai/xopc/config/schema.js';
import type { DmPolicy } from '@xopcai/xopc/channels/channel-domain.js';
import {
  registerPairingChannelResolver,
  resolveStandardAllowFromPath,
  resolveStandardPairingPath,
} from '@xopcai/xopc/channels/pairing/index.js';
import { resolveDmPolicy } from '@xopcai/xopc/channels/security.js';

function telegramBlock(config: Config | undefined): Record<string, unknown> | null {
  const ch = config?.channels?.telegram;
  return ch && typeof ch === 'object' && !Array.isArray(ch) ? (ch as Record<string, unknown>) : null;
}

function account(block: Record<string, unknown> | null, accountId: string): Record<string, unknown> | null {
  const accounts = block?.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return null;
  const acc = (accounts as Record<string, unknown>)[accountId];
  return acc && typeof acc === 'object' && !Array.isArray(acc) ? (acc as Record<string, unknown>) : null;
}

export function registerTelegramPairingResolver(): void {
  registerPairingChannelResolver('telegram', {
    resolvePaths(accountId) {
      return {
        pairingPath: resolveStandardPairingPath('telegram', accountId),
        allowPath: resolveStandardAllowFromPath('telegram', accountId),
      };
    },
    resolveAllowFromConfig(config, _channel, accountId) {
      const allow = account(telegramBlock(config), accountId)?.allowFrom;
      return Array.isArray(allow) ? [...new Set(allow.map(String).filter(Boolean))] : [];
    },
    resolveChannelEnabled(config) {
      return telegramBlock(config)?.enabled === true;
    },
    resolveAccountEnabled(config, _channel, accountId) {
      const block = telegramBlock(config);
      if (block?.enabled !== true) return false;
      return account(block, accountId)?.enabled !== false;
    },
    resolveDmPolicy(config, _channel, accountId) {
      const block = telegramBlock(config);
      const accPolicy = account(block, accountId)?.dmPolicy as DmPolicy | undefined;
      if (accPolicy) return resolveDmPolicy(accPolicy, 'pairing');
      const defaults = block?.defaults;
      const defaultPolicy =
        defaults && typeof defaults === 'object' && !Array.isArray(defaults)
          ? (defaults as { dmPolicy?: DmPolicy }).dmPolicy
          : undefined;
      return resolveDmPolicy(defaultPolicy, 'pairing');
    },
    resolveAccountIds(config) {
      const accounts = telegramBlock(config)?.accounts;
      if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
        const keys = Object.keys(accounts as Record<string, unknown>).sort();
        if (keys.length > 0) return keys;
      }
      return ['default'];
    },
  });
}

registerTelegramPairingResolver();
