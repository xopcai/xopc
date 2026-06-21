import type { Config } from '../../config/schema.js';
import { resolveDmPolicy } from '../security.js';
import type { DmPolicy } from '../channel-domain.js';

import { readAllowFromIdsSync, removeAllowFromIdSync } from './allow-from-file.js';
import type { PairingCliChannel } from './pairing-channel.js';
import { broadcastPairingEvent } from './pairing-events.js';
import { PAIRING_PENDING_MAX, PAIRING_STALE_PENDING_MS } from './pairing-constants.js';
import {
  approvePairingBySenderIdSync,
  approvePairingCodeSync,
  dismissPairingBySenderIdSync,
  listPendingPairingRequestsSync,
  PAIRING_PENDING_TTL_MS,
  type PairingRequest,
} from './pairing-store.js';
import {
  resolveStandardAllowFromPath,
  resolveStandardPairingPath,
} from './paths.js';

// `PairingPendingView` moved to `./pairing-types.js` (leaf) so
// `plugins/types.adapters.ts` and other lower-level callers can reference it
// without forming a `types.adapters → pairing-service → security → plugin-types
// → types.adapters` cycle. Re-exported here for backward-compat.
export { type PairingPendingView } from './pairing-types.js';
import type { PairingPendingView } from './pairing-types.js';

export type ChannelPairingState = {
  channel: PairingCliChannel;
  accountId: string;
  dmPolicy: DmPolicy;
  pending: PairingPendingView[];
  paired: {
    fromConfig: string[];
    fromCredentials: string[];
  };
};

export type PairingPaths = {
  pairingPath: string;
  allowPath: string;
};

export type PairingChannelConfigResolver = {
  resolvePaths?: (accountId: string) => PairingPaths;
  resolveAllowFromConfig?: (config: Config | undefined, channel: PairingCliChannel, accountId: string) => string[];
  resolveChannelEnabled?: (config: Config | undefined, channel: PairingCliChannel) => boolean;
  resolveAccountEnabled?: (config: Config | undefined, channel: PairingCliChannel, accountId: string) => boolean;
  resolveDmPolicy?: (config: Config | undefined, channel: PairingCliChannel, accountId: string) => DmPolicy;
  resolveAccountIds?: (config: Config | undefined, channel: PairingCliChannel) => string[];
};

const pairingResolvers = new Map<string, PairingChannelConfigResolver>();

export function registerPairingChannelResolver(
  channel: PairingCliChannel,
  resolver: PairingChannelConfigResolver,
): void {
  const id = channel.trim().toLowerCase();
  if (!id) return;
  pairingResolvers.set(id, resolver);
}

function normalizeAccountId(accountId: string | undefined): string {
  return (accountId ?? 'default').trim().toLowerCase() || 'default';
}

function channelBlock(config: Config | undefined, channel: PairingCliChannel): Record<string, unknown> | null {
  const ch = config?.channels?.[channel as keyof NonNullable<Config['channels']>];
  return ch && typeof ch === 'object' && !Array.isArray(ch) ? (ch as Record<string, unknown>) : null;
}

function channelResolver(channel: PairingCliChannel): PairingChannelConfigResolver {
  return pairingResolvers.get(channel.trim().toLowerCase()) ?? defaultPairingResolver;
}

function defaultPairingPaths(channel: PairingCliChannel, accountId: string): PairingPaths {
  const normalized = normalizeAccountId(accountId);
  return {
    pairingPath: resolveStandardPairingPath(channel, normalized),
    allowPath: resolveStandardAllowFromPath(channel, normalized),
  };
}

function defaultAllowFromConfig(
  config: Config | undefined,
  channel: PairingCliChannel,
  accountId: string,
): string[] {
  const block = channelBlock(config, channel);
  if (!block) return [];
  const top = Array.isArray(block.allowFrom)
    ? block.allowFrom.map(String).filter(Boolean)
    : [];
  const accounts = block.accounts;
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    const acc = (accounts as Record<string, unknown>)[accountId];
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      const fromAcc = (acc as { allowFrom?: unknown }).allowFrom;
      if (Array.isArray(fromAcc)) {
        return [...new Set([...top, ...fromAcc.map(String).filter(Boolean)])];
      }
    }
  }
  return [...new Set(top)];
}

function defaultChannelEnabled(config: Config | undefined, channel: PairingCliChannel): boolean {
  return channelBlock(config, channel)?.enabled === true;
}

function defaultAccountEnabled(
  config: Config | undefined,
  channel: PairingCliChannel,
  accountId: string,
): boolean {
  if (!defaultChannelEnabled(config, channel)) return false;
  const accounts = channelBlock(config, channel)?.accounts;
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    const acc = (accounts as Record<string, unknown>)[accountId];
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as { enabled?: boolean }).enabled !== false;
    }
  }
  return true;
}

function defaultDmPolicy(config: Config | undefined, channel: PairingCliChannel, accountId: string): DmPolicy {
  const block = channelBlock(config, channel);
  if (!block) return resolveDmPolicy(undefined, 'pairing');
  const accounts = block.accounts;
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    const acc = (accounts as Record<string, unknown>)[accountId];
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      const accPolicy = (acc as { dmPolicy?: DmPolicy }).dmPolicy;
      if (accPolicy) return resolveDmPolicy(accPolicy, 'pairing');
    }
  }
  return resolveDmPolicy(block.dmPolicy as DmPolicy | undefined, 'pairing');
}

function defaultAccountIds(config: Config | undefined, channel: PairingCliChannel): string[] {
  const accounts = channelBlock(config, channel)?.accounts;
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    const keys = Object.keys(accounts as Record<string, unknown>).sort();
    if (keys.length > 0) return keys;
  }
  return ['default'];
}

const defaultPairingResolver: PairingChannelConfigResolver = {
  resolveAllowFromConfig: defaultAllowFromConfig,
  resolveChannelEnabled: defaultChannelEnabled,
  resolveAccountEnabled: defaultAccountEnabled,
  resolveDmPolicy: defaultDmPolicy,
  resolveAccountIds: defaultAccountIds,
};

function resolvePairingPaths(channel: PairingCliChannel, accountId: string): PairingPaths {
  return channelResolver(channel).resolvePaths?.(normalizeAccountId(accountId)) ??
    defaultPairingPaths(channel, accountId);
}

function requestAccountId(entry: PairingRequest): string {
  const fromMeta = entry.meta?.accountId?.trim().toLowerCase();
  return fromMeta || 'default';
}

function toPendingView(entry: PairingRequest): PairingPendingView {
  const createdMs = Date.parse(entry.createdAt);
  const expiresAt = Number.isFinite(createdMs)
    ? new Date(createdMs + PAIRING_PENDING_TTL_MS).toISOString()
    : new Date(Date.now() + PAIRING_PENDING_TTL_MS).toISOString();
  const code = entry.code ?? '';
  const codeLast4 = code.length >= 4 ? code.slice(-4) : code;
  const meta =
    entry.meta && typeof entry.meta === 'object'
      ? Object.fromEntries(
          Object.entries(entry.meta).filter(
            ([k, v]) => k !== 'accountId' && typeof v === 'string' && v.trim() !== '',
          ),
        )
      : undefined;
  return {
    senderId: entry.id,
    codeLast4,
    createdAt: entry.createdAt,
    lastSeenAt: entry.lastSeenAt,
    expiresAt,
    isStale:
      Number.isFinite(createdMs) && Date.now() - (createdMs as number) >= PAIRING_STALE_PENDING_MS,
    meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
  };
}

function pendingEntryStats(pending: PairingRequest[]): {
  pending: number;
  stale: number;
  atCapacity: boolean;
} {
  const now = Date.now();
  let stale = 0;
  for (const p of pending) {
    const created = Date.parse(p.createdAt);
    if (Number.isFinite(created) && now - created >= PAIRING_STALE_PENDING_MS) {
      stale += 1;
    }
  }
  return {
    pending: pending.length,
    stale,
    atCapacity: pending.length >= PAIRING_PENDING_MAX,
  };
}

function resolveChannelEnabled(config: Config | undefined, channel: PairingCliChannel): boolean {
  return channelResolver(channel).resolveChannelEnabled?.(config, channel) ??
    defaultChannelEnabled(config, channel);
}

function resolveAccountEnabled(
  config: Config | undefined,
  channel: PairingCliChannel,
  accountId: string,
): boolean {
  return channelResolver(channel).resolveAccountEnabled?.(config, channel, accountId) ??
    defaultAccountEnabled(config, channel, accountId);
}

function resolveChannelDmPolicy(
  config: Config | undefined,
  channel: PairingCliChannel,
  accountId: string,
): DmPolicy {
  return channelResolver(channel).resolveDmPolicy?.(config, channel, accountId) ??
    defaultDmPolicy(config, channel, accountId);
}

export type ChannelPairingSummaryEntry = {
  pending: number;
  stale: number;
  atCapacity: boolean;
};

export type ChannelPairingSummary = Record<string, ChannelPairingSummaryEntry>;

export type PairingPendingIssue = {
  channel: PairingCliChannel;
  accountId: string;
  pending: number;
  stale: number;
  atCapacity: boolean;
};

function resolvePairingAccountIds(config: Config | undefined, channel: PairingCliChannel): string[] {
  return channelResolver(channel).resolveAccountIds?.(config, channel) ??
    defaultAccountIds(config, channel);
}

export function listChannelPairingSummary(config?: Config): ChannelPairingSummary {
  const channels = Object.keys(config?.channels ?? {});
  const summary: ChannelPairingSummary = {};
  for (const channel of channels) {
    if (!resolveChannelEnabled(config, channel)) continue;
    summary[channel] = { pending: 0, stale: 0, atCapacity: false };
    const accountIds = resolvePairingAccountIds(config, channel);
    for (const accountId of accountIds) {
      if (!resolveAccountEnabled(config, channel, accountId)) continue;
      if (resolveChannelDmPolicy(config, channel, accountId) !== 'pairing') continue;
      const { pairingPath } = resolvePairingPaths(channel, accountId);
      const pendingRaw = listPendingPairingRequestsSync(pairingPath).filter(
        (r) => requestAccountId(r) === accountId,
      );
      const stats = pendingEntryStats(pendingRaw);
      summary[channel]!.pending += stats.pending;
      summary[channel]!.stale += stats.stale;
      summary[channel]!.atCapacity ||= stats.atCapacity;
    }
  }
  return summary;
}

export function collectPairingPendingIssues(config?: Config): PairingPendingIssue[] {
  const issues: PairingPendingIssue[] = [];
  for (const channel of Object.keys(config?.channels ?? {})) {
    if (!resolveChannelEnabled(config, channel)) continue;
    const accountIds = resolvePairingAccountIds(config, channel);
    for (const accountId of accountIds) {
      if (!resolveAccountEnabled(config, channel, accountId)) continue;
      if (resolveChannelDmPolicy(config, channel, accountId) !== 'pairing') continue;
      const { pairingPath } = resolvePairingPaths(channel, accountId);
      const pendingRaw = listPendingPairingRequestsSync(pairingPath).filter(
        (r) => requestAccountId(r) === accountId,
      );
      const stats = pendingEntryStats(pendingRaw);
      if (stats.pending > 0) {
        issues.push({ channel, accountId, ...stats });
      }
    }
  }
  return issues;
}

export function listChannelPairingState(params: {
  channel: PairingCliChannel;
  accountId?: string;
  config?: Config;
}): ChannelPairingState {
  const accountId = normalizeAccountId(params.accountId);
  const { pairingPath, allowPath } = resolvePairingPaths(params.channel, accountId);
  const pendingRaw = listPendingPairingRequestsSync(pairingPath).filter(
    (r) => requestAccountId(r) === accountId,
  );
  return {
    channel: params.channel,
    accountId,
    dmPolicy: resolveChannelDmPolicy(params.config, params.channel, accountId),
    pending: pendingRaw.map(toPendingView),
    paired: {
      fromConfig:
        channelResolver(params.channel).resolveAllowFromConfig?.(params.config, params.channel, accountId) ??
        defaultAllowFromConfig(params.config, params.channel, accountId),
      fromCredentials: readAllowFromIdsSync(allowPath),
    },
  };
}

export function approveChannelPairing(params: {
  channel: PairingCliChannel;
  accountId?: string;
  code: string;
}): { ok: true; senderId: string; alreadyPaired: boolean } | { ok: false; error: string } {
  const accountId = normalizeAccountId(params.accountId);
  const code = params.code.trim();
  if (!code) return { ok: false, error: 'Missing pairing code.' };

  const { pairingPath, allowPath } = resolvePairingPaths(params.channel, accountId);
  const alreadyPaired = readAllowFromIdsSync(allowPath);

  const result = approvePairingCodeSync({
    pairingFilePath: pairingPath,
    allowFromFilePath: allowPath,
    code,
    accountId,
  });
  if (!result) {
    return { ok: false, error: 'Invalid or expired pairing code (or wrong account).' };
  }
  broadcastPairingEvent('channels.pairing.approved', {
    channel: params.channel,
    accountId,
    senderId: result.senderId,
  });
  return {
    ok: true,
    senderId: result.senderId,
    alreadyPaired: alreadyPaired.includes(result.senderId),
  };
}

export function approveChannelPairingBySender(params: {
  channel: PairingCliChannel;
  accountId?: string;
  senderId: string;
}): { ok: true; senderId: string; alreadyPaired: boolean } | { ok: false; error: string } {
  const accountId = normalizeAccountId(params.accountId);
  const senderId = params.senderId.trim();
  if (!senderId) return { ok: false, error: 'Missing sender id.' };

  const { pairingPath, allowPath } = resolvePairingPaths(params.channel, accountId);
  const alreadyPaired = readAllowFromIdsSync(allowPath);

  const result = approvePairingBySenderIdSync({
    pairingFilePath: pairingPath,
    allowFromFilePath: allowPath,
    senderId,
    accountId,
  });
  if (!result) {
    return { ok: false, error: 'No pending pairing request for this sender (or wrong account).' };
  }
  broadcastPairingEvent('channels.pairing.approved', {
    channel: params.channel,
    accountId,
    senderId: result.senderId,
  });
  return {
    ok: true,
    senderId: result.senderId,
    alreadyPaired: alreadyPaired.includes(result.senderId),
  };
}

export function revokeChannelPairingPaired(params: {
  channel: PairingCliChannel;
  accountId?: string;
  senderId: string;
}): { ok: true; changed: boolean } | { ok: false; error: string } {
  const accountId = normalizeAccountId(params.accountId);
  const senderId = params.senderId.trim();
  if (!senderId) return { ok: false, error: 'Missing sender id.' };

  const { allowPath } = resolvePairingPaths(params.channel, accountId);
  const { changed } = removeAllowFromIdSync(allowPath, senderId);
  if (changed) {
    broadcastPairingEvent('channels.pairing.revoked', {
      channel: params.channel,
      accountId,
      senderId,
    });
  }
  return { ok: true, changed };
}

export function dismissChannelPairingPending(params: {
  channel: PairingCliChannel;
  accountId?: string;
  senderId: string;
}): { ok: true; senderId: string } | { ok: false; error: string } {
  const accountId = normalizeAccountId(params.accountId);
  const senderId = params.senderId.trim();
  if (!senderId) return { ok: false, error: 'Missing sender id.' };

  const { pairingPath } = resolvePairingPaths(params.channel, accountId);
  const result = dismissPairingBySenderIdSync({
    pairingFilePath: pairingPath,
    senderId,
    accountId,
  });
  if (!result) {
    return { ok: false, error: 'No pending pairing request for this sender (or wrong account).' };
  }
  broadcastPairingEvent('channels.pairing.dismissed', {
    channel: params.channel,
    accountId,
    senderId: result.senderId,
  });
  return { ok: true, senderId: result.senderId };
}
