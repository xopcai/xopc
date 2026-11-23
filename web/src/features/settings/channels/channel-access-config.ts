import type { ChannelCatalogEntry } from './use-channel-catalog';

export type DmPolicyValue = 'pairing' | 'open' | 'allowlist' | 'disabled';
export type GroupPolicyValue = 'open' | 'allowlist' | 'disabled';

export type ChannelAccessView = {
  accountId: string;
  supportsDm: boolean;
  supportsGroup: boolean;
  dmPolicy: DmPolicyValue;
  allowFrom: string[];
  groupPolicy: GroupPolicyValue;
  groupAllowFrom: string[];
};

const CREDENTIAL_AND_ACCESS_KEYS = new Set([
  'enabled',
  'botToken',
  'tokenFile',
  'appId',
  'appSecret',
  'clientId',
  'clientSecret',
  'botId',
  'secret',
  'appToken',
  'credentialIdentity',
  'dmPolicy',
  'allowFrom',
  'groupPolicy',
  'groupAllowFrom',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function normalizeDmPolicy(value: unknown, fallback: DmPolicyValue): DmPolicyValue {
  if (value === 'pairing' || value === 'open' || value === 'allowlist' || value === 'disabled') {
    return value;
  }
  return fallback;
}

function normalizeGroupPolicy(value: unknown, fallback: GroupPolicyValue): GroupPolicyValue {
  if (value === 'open' || value === 'allowlist' || value === 'disabled') {
    return value;
  }
  return fallback;
}

function defaultDmPolicyForChannel(channelId: string): DmPolicyValue {
  if (channelId === 'weixin' || channelId === 'feishu' || channelId === 'lark') return 'open';
  return 'pairing';
}

function defaultGroupPolicyForChannel(channelId: string): GroupPolicyValue {
  if (channelId === 'telegram') return 'open';
  return 'allowlist';
}

/**
 * Resolve the primary account scope for channels that store credentials and
 * access policy under `accounts.<id>` (Telegram, Weixin, Feishu), or undefined
 * for flat single-account channels (DingTalk, WeCom, Discord, Slack).
 */
export function resolveChannelPrimaryAccountKey(
  channelId: string,
  config: Record<string, unknown>,
): string | undefined {
  const accounts = isRecord(config.accounts) ? config.accounts : undefined;
  if (accounts) {
    if (typeof config.defaultAccount === 'string' && Object.hasOwn(accounts, config.defaultAccount)) {
      return config.defaultAccount;
    }
    if (Object.hasOwn(accounts, 'default')) return 'default';
    const first = Object.keys(accounts)[0];
    if (first) return first;
  }
  if (channelId === 'telegram') return 'default';
  return undefined;
}

function schemaHasGroupPolicy(entry: ChannelCatalogEntry | undefined): boolean {
  if (!entry || entry.id === 'weixin') return false;
  const props = isRecord(entry.configSchema?.properties) ? entry.configSchema.properties : {};
  if ('groupPolicy' in props) return true;
  const accountsProps = isRecord(props.accounts) && isRecord(props.accounts.properties)
    ? props.accounts.properties
    : {};
  const defaultProps = isRecord(accountsProps.default) && isRecord(accountsProps.default.properties)
    ? accountsProps.default.properties
    : {};
  return 'groupPolicy' in defaultProps;
}

function schemaHasDmPolicy(entry: ChannelCatalogEntry | undefined): boolean {
  if (!entry) return false;
  const props = isRecord(entry.configSchema?.properties) ? entry.configSchema.properties : {};
  if ('dmPolicy' in props) return true;
  const accountsProps = isRecord(props.accounts) && isRecord(props.accounts.properties)
    ? props.accounts.properties
    : {};
  const defaultProps = isRecord(accountsProps.default) && isRecord(accountsProps.default.properties)
    ? accountsProps.default.properties
    : {};
  return 'dmPolicy' in defaultProps;
}

export function readChannelAccessView(
  entry: ChannelCatalogEntry | undefined,
  config: Record<string, unknown>,
): ChannelAccessView {
  const channelId = entry?.id ?? '';
  const accountKey = resolveChannelPrimaryAccountKey(channelId, config);
  const accounts = isRecord(config.accounts) ? config.accounts : {};
  const account = accountKey && isRecord(accounts[accountKey]) ? accounts[accountKey] : {};
  const defaults = isRecord(config.defaults) ? config.defaults : {};

  const rawDm = account.dmPolicy ?? config.dmPolicy ?? defaults.dmPolicy;
  const rawAllowFrom = account.allowFrom ?? config.allowFrom;
  const rawGroup = account.groupPolicy ?? config.groupPolicy ?? defaults.groupPolicy;
  const rawGroupAllowFrom = account.groupAllowFrom ?? config.groupAllowFrom;

  return {
    accountId: accountKey ?? 'default',
    supportsDm: schemaHasDmPolicy(entry),
    supportsGroup: schemaHasGroupPolicy(entry),
    dmPolicy: normalizeDmPolicy(rawDm, defaultDmPolicyForChannel(channelId)),
    allowFrom: asStringArray(rawAllowFrom),
    groupPolicy: normalizeGroupPolicy(rawGroup, defaultGroupPolicyForChannel(channelId)),
    groupAllowFrom: asStringArray(rawGroupAllowFrom),
  };
}

export function updateChannelAccessConfig(
  channelId: string,
  config: Record<string, unknown>,
  patch: Partial<Pick<ChannelAccessView, 'dmPolicy' | 'allowFrom' | 'groupPolicy' | 'groupAllowFrom'>>,
): Record<string, unknown> {
  const accountKey = resolveChannelPrimaryAccountKey(channelId, config);
  const nextPatch: Record<string, unknown> = {};
  if (patch.dmPolicy !== undefined) {
    nextPatch.dmPolicy = patch.dmPolicy;
    if (patch.dmPolicy === 'open' && channelId === 'telegram' && patch.allowFrom === undefined) {
      nextPatch.allowFrom = ['*'];
    }
  }
  if (patch.allowFrom !== undefined) nextPatch.allowFrom = patch.allowFrom;
  if (patch.groupPolicy !== undefined) nextPatch.groupPolicy = patch.groupPolicy;
  if (patch.groupAllowFrom !== undefined) nextPatch.groupAllowFrom = patch.groupAllowFrom;

  if (accountKey) {
    const accounts = isRecord(config.accounts) ? config.accounts : {};
    const existingAccount = isRecord(accounts[accountKey]) ? accounts[accountKey] : {};
    return {
      ...config,
      accounts: {
        ...accounts,
        [accountKey]: {
          ...existingAccount,
          ...nextPatch,
        },
      },
    };
  }

  return {
    ...config,
    ...nextPatch,
  };
}

/**
 * Paths managed by dedicated UI controls (enable switch, credential setup card,
 * and simplified access control) so they are never duplicated in raw SchemaForm.
 */
export function getManagedChannelSchemaPaths(entry: ChannelCatalogEntry | undefined): string[] {
  if (!entry) return ['enabled'];
  const hasSetupAction = Boolean(entry.actions && Object.keys(entry.actions).some((id) => id !== 'doctor.run'));
  const paths = new Set<string>(['enabled', 'dmPolicy', 'allowFrom', 'groupPolicy', 'groupAllowFrom']);
  if (hasSetupAction) {
    for (const key of CREDENTIAL_AND_ACCESS_KEYS) {
      paths.add(key);
      paths.add(`accounts.default.${key}`);
      paths.add(`defaults.${key}`);
    }
    paths.add('accounts.default.accountId');
    paths.add('accounts.default.enabled');
    paths.add('accounts.default.name');
  }
  return [...paths];
}
