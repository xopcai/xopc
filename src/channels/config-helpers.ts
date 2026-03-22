/**
 * Channel config adapter factories (OpenClaw-style).
 */

import type { Config } from '../config/index.js';
import type { ChannelConfigAdapter } from './plugin-types.js';

export function createTopLevelChannelConfigAdapter<ResolvedAccount>(params: {
  sectionKey: string;
  resolveAccount: (cfg: Config) => ResolvedAccount;
  deleteMode?: 'remove-section' | 'clear-fields';
  resolveAllowFrom?: (account: ResolvedAccount) => Array<string | number> | undefined;
  formatAllowFrom?: (allowFrom: Array<string | number>) => string[];
}): ChannelConfigAdapter<ResolvedAccount> {
  return {
    listAccountIds: () => ['default'],
    resolveAccount: (cfg) => params.resolveAccount(cfg),
    defaultAccountId: () => 'default',
    isEnabled: (account) => (account as { enabled?: boolean }).enabled !== false,
    resolveAllowFrom: params.resolveAllowFrom
      ? ({ cfg }) => params.resolveAllowFrom!(params.resolveAccount(cfg))
      : undefined,
    formatAllowFrom: params.formatAllowFrom
      ? ({ allowFrom }) => params.formatAllowFrom!(allowFrom)
      : undefined,
  };
}

export function createScopedChannelConfigAdapter<ResolvedAccount>(params: {
  sectionKey: string;
  listAccountIds: (cfg: Config) => string[];
  resolveAccount: (cfg: Config, accountId?: string | null) => ResolvedAccount;
  defaultAccountId: (cfg: Config) => string;
  resolveAllowFrom: (account: ResolvedAccount) => Array<string | number> | undefined;
  formatAllowFrom: (allowFrom: Array<string | number>) => string[];
}): ChannelConfigAdapter<ResolvedAccount> {
  return {
    listAccountIds: params.listAccountIds,
    resolveAccount: params.resolveAccount,
    defaultAccountId: params.defaultAccountId,
    isEnabled: (account) => (account as { enabled?: boolean }).enabled !== false,
    resolveAllowFrom: ({ cfg, accountId }) =>
      params.resolveAllowFrom(params.resolveAccount(cfg, accountId)),
    formatAllowFrom: ({ allowFrom }) => params.formatAllowFrom(allowFrom),
  };
}

export function createHybridChannelConfigAdapter<ResolvedAccount>(params: {
  sectionKey: string;
  listAccountIds: (cfg: Config) => string[];
  resolveAccount: (cfg: Config, accountId?: string | null) => ResolvedAccount;
  resolveAllowFrom?: (account: ResolvedAccount) => Array<string | number> | undefined;
  formatAllowFrom?: (allowFrom: Array<string | number>) => string[];
}): ChannelConfigAdapter<ResolvedAccount> {
  return {
    listAccountIds: params.listAccountIds,
    resolveAccount: params.resolveAccount,
    defaultAccountId: () => 'default',
    isEnabled: (account) => (account as { enabled?: boolean }).enabled !== false,
    resolveAllowFrom: params.resolveAllowFrom
      ? ({ cfg, accountId }) => params.resolveAllowFrom!(params.resolveAccount(cfg, accountId))
      : undefined,
    formatAllowFrom: params.formatAllowFrom
      ? ({ allowFrom }) => params.formatAllowFrom!(allowFrom)
      : undefined,
  };
}
