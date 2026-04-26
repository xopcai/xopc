import type { Config } from '@xopcai/xopc/config/schema.js';

import type { FeishuAccountConfig, FeishuConfig } from '../schema/config-schema.js';

export interface ResolvedFeishuAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;

  appId?: string;
  appSecret?: string;
  domain: 'feishu' | 'lark' | string;
  connectionMode: 'websocket' | 'webhook';

  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  verificationToken?: string;
  encryptKey?: string;

  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy: 'open' | 'disabled' | 'allowlist';
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  requireMention?: boolean;

  historyLimit: number;
  textChunkLimit: number;
  renderMode?: 'auto' | 'raw' | 'card';

  reactionNotifications?: 'off' | 'own' | 'all';

  /** Opt-in: only `true` enables Feishu streaming (Thinking… + incremental updates). */
  streaming: boolean;
  blockStreamingCoalesce?: { enabled?: boolean; minChars?: number; idleMs?: number };

  tools?: FeishuConfig['tools'];
  actions?: FeishuConfig['actions'];
  dynamicAgentCreation?: FeishuConfig['dynamicAgentCreation'];
}

function asFeishuSection(cfg: Config): FeishuConfig | undefined {
  return cfg.channels?.feishu as FeishuConfig | undefined;
}

export function listFeishuAccountIds(cfg: Config): string[] {
  const section = asFeishuSection(cfg);
  if (!section) return [];
  const accounts = section.accounts ?? {};
  const keys = Object.keys(accounts);
  if (keys.length > 0) return keys;
  // Single-account layout
  return ['default'];
}

function resolveRootAccount(section: FeishuConfig): FeishuAccountConfig {
  return {
    enabled: section.enabled,
    name: 'Default Account',
    appId: section.appId,
    appSecret: section.appSecret,
    domain: section.domain,
    connectionMode: section.connectionMode,
    webhookHost: (section as any).webhookHost,
    webhookPort: (section as any).webhookPort,
    webhookPath: (section as any).webhookPath,
    verificationToken: (section as any).verificationToken,
    encryptKey: (section as any).encryptKey,
    dmPolicy: section.dmPolicy,
    groupPolicy: section.groupPolicy,
    allowFrom: section.allowFrom,
    groupAllowFrom: section.groupAllowFrom,
    requireMention: section.requireMention,
    historyLimit: section.historyLimit,
    textChunkLimit: section.textChunkLimit,
    renderMode: (section as any).renderMode,
    reactionNotifications: section.reactionNotifications,
    streaming: section.streaming,
    blockStreamingCoalesce: section.blockStreamingCoalesce,
    tools: section.tools,
    actions: section.actions,
    dynamicAgentCreation: section.dynamicAgentCreation,
  };
}

function mergeAccount(section: FeishuConfig, account: FeishuAccountConfig | undefined): FeishuAccountConfig {
  const root = resolveRootAccount(section);
  if (!account) return root;
  return {
    ...root,
    ...account,
    // arrays should replace, not concat
    allowFrom: account.allowFrom ?? root.allowFrom,
    groupAllowFrom: account.groupAllowFrom ?? root.groupAllowFrom,
  };
}

export function resolveFeishuAccount(cfg: Config, accountId?: string | null): ResolvedFeishuAccount {
  const section = asFeishuSection(cfg) ?? ({ enabled: false } as FeishuConfig);
  const requested = (accountId ?? '').trim();

  const accounts = section.accounts ?? {};
  const hasNamedAccounts = Object.keys(accounts).length > 0;
  const effectiveAccountId = requested || section.defaultAccount || (hasNamedAccounts ? Object.keys(accounts)[0] : 'default');

  const raw = hasNamedAccounts ? accounts[effectiveAccountId] : resolveRootAccount(section);
  const merged = mergeAccount(section, raw);

  const enabled = merged.enabled !== false && section.enabled !== false;
  const appId = merged.appId?.trim() || undefined;
  const appSecret = merged.appSecret?.trim() || undefined;
  const configured = Boolean(appId && appSecret);

  return {
    accountId: effectiveAccountId,
    name: merged.name,
    enabled,
    configured,
    appId,
    appSecret,
    domain: (merged.domain ?? 'feishu') as any,
    connectionMode: (merged.connectionMode ?? 'websocket') as any,
    webhookHost: (merged as any).webhookHost,
    webhookPort: (merged as any).webhookPort,
    webhookPath: (merged as any).webhookPath,
    verificationToken: (merged as any).verificationToken,
    encryptKey: (merged as any).encryptKey,
    dmPolicy: (merged.dmPolicy ?? 'pairing') as any,
    groupPolicy: (merged.groupPolicy ?? 'allowlist') as any,
    allowFrom: merged.allowFrom,
    groupAllowFrom: merged.groupAllowFrom,
    requireMention: merged.requireMention,
    historyLimit: typeof merged.historyLimit === 'number' ? merged.historyLimit : 50,
    textChunkLimit: typeof merged.textChunkLimit === 'number' ? merged.textChunkLimit : 4000,
    renderMode: (merged as any).renderMode,
    reactionNotifications: merged.reactionNotifications,
    streaming: merged.streaming === true,
    blockStreamingCoalesce: merged.blockStreamingCoalesce as any,
    tools: merged.tools,
    actions: merged.actions,
    dynamicAgentCreation: merged.dynamicAgentCreation,
  };
}

