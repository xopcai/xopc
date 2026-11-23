import type { Config } from '@xopcai/xopc/config/schema.js';

import {
  listWeixinAccountIds,
  normalizeWeixinAccountId,
  resolveWeixinAccount,
  type ResolvedWeixinAccount,
} from './auth/accounts.js';
import { readFrameworkAllowFromList } from './auth/pairing.js';
import { canonicalWeixinPeerId, toRawIlinkUserIdForApi } from './auth/weixin-account-id.js';
import { listContextTokenPeersForAccount } from './messaging/inbound.js';

export type DeliverableWeixinTarget = {
  accountId: string;
  chatId: string;
};

export type WeixinChannelReadiness = {
  enabled: boolean;
  accountCount: number;
  configuredAccountCount: number;
  hasCredential: boolean;
  dmPolicy?: string;
  deliverableRecipientCount: number;
};

function isPeerAllowedForAccount(
  account: ResolvedWeixinAccount,
  peerKey: string,
  sendTo?: string,
): boolean {
  if (account.dmPolicy === 'disabled') return false;
  if (account.dmPolicy === 'open') return true;
  const allowFrom = [...(account.allowFrom ?? []), ...readFrameworkAllowFromList(account.accountId)];
  if (allowFrom.some((entry) => entry.trim() === '*')) return true;
  const normalizedSendTo = sendTo?.trim().toLowerCase();
  return allowFrom.some((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return false;
    if (normalizedSendTo && trimmed.toLowerCase() === normalizedSendTo) return true;
    return canonicalWeixinPeerId(trimmed) === peerKey;
  });
}

function resolveEnabledConfiguredWeixinAccounts(
  cfg: Config,
  requestedAccountId?: string,
): ResolvedWeixinAccount[] {
  const section = cfg.channels?.weixin as { enabled?: boolean } | undefined;
  if (!section || section.enabled !== true) return [];

  const allIds = listWeixinAccountIds(cfg);
  const candidateIds = requestedAccountId?.trim()
    ? allIds.filter((id) => normalizeWeixinAccountId(id) === normalizeWeixinAccountId(requestedAccountId))
    : allIds;

  const accounts: ResolvedWeixinAccount[] = [];
  for (const id of candidateIds) {
    try {
      const account = resolveWeixinAccount(cfg, id);
      if (account.enabled && account.configured && account.token) {
        accounts.push(account);
      }
    } catch {
      // Ignore invalid/unconfigured account entries during target discovery.
    }
  }
  return accounts;
}

/**
 * List Weixin DM recipients that can receive proactive outbound messages
 * (enabled + logged-in account, allowed by dmPolicy, and cached context_token).
 * Returns only non-secret account/chat identifiers.
 */
export function listDeliverableWeixinTargets(
  cfg: Config,
  requestedAccountId?: string,
): DeliverableWeixinTarget[] {
  const accounts = resolveEnabledConfiguredWeixinAccounts(cfg, requestedAccountId);
  const seen = new Set<string>();
  const targets: DeliverableWeixinTarget[] = [];

  for (const account of accounts) {
    for (const peer of listContextTokenPeersForAccount(account.accountId)) {
      if (!isPeerAllowedForAccount(account, peer.peerKey, peer.sendTo)) continue;
      const chatId = peer.sendTo?.trim() || toRawIlinkUserIdForApi(peer.peerKey);
      if (!chatId) continue;
      const dedupeKey = `${account.accountId}:${canonicalWeixinPeerId(chatId)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      targets.push({ accountId: account.accountId, chatId });
    }
  }

  return targets;
}

/**
 * Non-secret readiness summary for Weixin, checking disk-backed credentials and
 * deliverable recipients.
 */
export function inspectWeixinChannelState(cfg: Config): WeixinChannelReadiness {
  const section = cfg.channels?.weixin as { enabled?: boolean; dmPolicy?: string } | undefined;
  const enabled = section?.enabled === true;
  const ids = listWeixinAccountIds(cfg);
  let configuredAccountCount = 0;
  let dmPolicy: string | undefined = typeof section?.dmPolicy === 'string' ? section.dmPolicy : undefined;

  for (const id of ids) {
    try {
      const account = resolveWeixinAccount(cfg, id);
      if (account.configured && account.token) {
        configuredAccountCount += 1;
      }
      if (!dmPolicy) {
        dmPolicy = account.dmPolicy;
      }
    } catch {
      // Ignore malformed entries.
    }
  }

  const deliverableRecipientCount = enabled ? listDeliverableWeixinTargets(cfg).length : 0;

  return {
    enabled,
    accountCount: ids.length,
    configuredAccountCount,
    hasCredential: configuredAccountCount > 0,
    ...(dmPolicy ? { dmPolicy } : {}),
    deliverableRecipientCount,
  };
}
