import type { Config } from '@xopcai/xopc/config/schema.js';

import { DEFAULT_DINGTALK_ACCOUNT_ID, type DingtalkConfig, type DingtalkAccountOverride } from './config-schema.js';

export type ResolvedDingtalkAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  clientId: string;
  clientSecret: string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy: 'open' | 'disabled' | 'allowlist';
  allowFrom: Array<string | number>;
  groupAllowFrom: Array<string | number>;
  requireMention: boolean;
  debug: boolean;
  endpoint: string;
  historyLimit: number;
  textChunkLimit: number;
  raw: DingtalkConfig;
};

function getSection(cfg: Config): DingtalkConfig | undefined {
  return cfg.channels?.dingtalk as DingtalkConfig | undefined;
}

function listConfiguredAccountIds(cfg: Config): string[] {
  const accounts = getSection(cfg)?.accounts;
  if (!accounts || typeof accounts !== 'object') {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listDingtalkAccountIds(cfg: Config): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_DINGTALK_ACCOUNT_ID];
  }
  return [...ids].toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultDingtalkAccountId(cfg: Config): string {
  const preferred = getSection(cfg)?.defaultAccount?.trim();
  if (preferred) return preferred;
  const ids = listDingtalkAccountIds(cfg);
  if (ids.includes(DEFAULT_DINGTALK_ACCOUNT_ID)) return DEFAULT_DINGTALK_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_DINGTALK_ACCOUNT_ID;
}

function accountOverride(cfg: Config, accountId: string): DingtalkAccountOverride | undefined {
  return getSection(cfg)?.accounts?.[accountId];
}

/** Merge top-level dingtalk config with per-account overrides. */
function mergeAccountConfig(cfg: Config, accountId: string): DingtalkConfig {
  const base = getSection(cfg) ?? {};
  const { accounts: _a, defaultAccount: _d, ...rest } = base;
  const acc = accountOverride(cfg, accountId) ?? {};
  return { ...rest, ...acc } as DingtalkConfig;
}

export function resolveDingtalkAccount(cfg: Config, accountId?: string | null): ResolvedDingtalkAccount {
  const id = accountId?.trim() || resolveDefaultDingtalkAccountId(cfg);
  const merged = mergeAccountConfig(cfg, id);
  const section = getSection(cfg);
  const topEnabled = section?.enabled === true;
  const ov = accountOverride(cfg, id);
  const clientId = String(merged.clientId ?? '').trim();
  const clientSecret = String(merged.clientSecret ?? '').trim();
  const configured = Boolean(clientId && clientSecret);

  const enabled =
    Boolean(section) &&
    topEnabled &&
    configured &&
    (id === DEFAULT_DINGTALK_ACCOUNT_ID ? ov?.enabled !== false : ov?.enabled === true);

  return {
    accountId: id,
    enabled,
    configured,
    clientId,
    clientSecret,
    dmPolicy: merged.dmPolicy ?? 'open',
    groupPolicy: merged.groupPolicy ?? 'open',
    allowFrom: merged.allowFrom ?? [],
    groupAllowFrom: merged.groupAllowFrom ?? merged.allowFrom ?? [],
    requireMention: merged.requireMention === true,
    debug: merged.debug === true,
    endpoint: (merged.endpoint ?? 'https://api.dingtalk.com').trim() || 'https://api.dingtalk.com',
    historyLimit: typeof merged.historyLimit === 'number' ? merged.historyLimit : 50,
    textChunkLimit: typeof merged.textChunkLimit === 'number' ? merged.textChunkLimit : 4000,
    raw: merged,
  };
}
