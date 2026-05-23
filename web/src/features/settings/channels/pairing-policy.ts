import {
  feishuRoutingAccountIds,
  telegramRoutingAccountIds,
  weixinRoutingAccountIds,
} from '@/features/settings/channel-bindings-merge';
import type {
  DmPolicy,
  FeishuConfig,
  TelegramConfig,
  WeixinConfig,
} from '@/features/settings/channels-settings.types';

export type PairingPolicyChannelId = 'telegram' | 'feishu' | 'weixin';

function defaultChannelDmPolicy(channel: PairingPolicyChannelId): DmPolicy {
  return channel === 'telegram' ? 'pairing' : 'open';
}

export function resolveAccountDmPolicy(
  channel: PairingPolicyChannelId,
  topDmPolicy: DmPolicy | undefined,
  account?: { dmPolicy?: DmPolicy },
): DmPolicy {
  if (account?.dmPolicy) return account.dmPolicy;
  return topDmPolicy ?? defaultChannelDmPolicy(channel);
}

export function listPairingAccountIds(
  channel: PairingPolicyChannelId,
  config: TelegramConfig | WeixinConfig | FeishuConfig,
): string[] {
  if (channel === 'telegram') {
    const ids = telegramRoutingAccountIds(config as TelegramConfig);
    return ids.length > 0 ? ids : ['default'];
  }
  if (channel === 'weixin') {
    const ids = weixinRoutingAccountIds(config as WeixinConfig);
    return ids.length > 0 ? ids : ['default'];
  }
  const ids = feishuRoutingAccountIds(config as FeishuConfig);
  return ids.length > 0 ? ids : ['default'];
}

export function isPairingAccountEnabled(account?: { enabled?: boolean }): boolean {
  return account?.enabled !== false;
}

export function resolveAccountDmPolicyForConfig(
  channel: PairingPolicyChannelId,
  config: TelegramConfig | WeixinConfig | FeishuConfig,
  accountId: string,
): DmPolicy {
  const acc = config.accounts?.[accountId];
  return resolveAccountDmPolicy(channel, config.dmPolicy, acc);
}

/** True when any enabled account uses pairing (matches gateway pairing-service). */
export function channelUsesPairingPolicy(
  channel: PairingPolicyChannelId,
  config: TelegramConfig | WeixinConfig | FeishuConfig,
): boolean {
  const accountIds = listPairingAccountIds(channel, config);
  return accountIds.some((id) => {
    const acc = config.accounts?.[id];
    if (!isPairingAccountEnabled(acc)) return false;
    return resolveAccountDmPolicyForConfig(channel, config, id) === 'pairing';
  });
}

/** Hub badge: channel configured, enabled, pairing policy active. */
export function hubPairingPendingCount(params: {
  configured: boolean;
  channelEnabled: boolean;
  usesPairing: boolean;
  summaryPending: number;
}): number {
  if (!params.configured || !params.channelEnabled || !params.usesPairing) return 0;
  return params.summaryPending;
}
