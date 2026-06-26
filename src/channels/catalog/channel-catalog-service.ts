import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { resolveStateDir } from '../../config/paths-state.js';
import {
  buildExtensionMetadataSnapshot,
  resolveExtensionLoaderOptionsFromConfig,
} from '../../extensions/extension-metadata-snapshot.js';
import type { ExtensionMetadataSnapshot } from '../../extensions/extension-metadata-snapshot.js';
import type { ManifestRegistryEntry } from '../../extensions/manifest-registry.js';
import type { ChannelContributionDeclaration } from '../../extensions/types/manifest.js';

import type { ChannelCatalog, ChannelCatalogEntry, ChannelSetupIssue, ChannelSetupStatus } from './channel-catalog-types.js';

type BuildChannelCatalogOptions = {
  locale?: string;
};

const DEFAULT_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true,
};

function normalizeChannelId(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeLocale(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase().replace('_', '-');
  return value || undefined;
}

function localeCandidates(raw: string | undefined): string[] {
  const locale = normalizeLocale(raw);
  if (!locale) return [];
  const base = locale.split('-')[0];
  return base && base !== locale ? [locale, base] : [locale];
}

function normalizeConfigPath(channelId: string, raw: string | undefined): `channels.${string}` {
  const expected = `channels.${channelId}` as const;
  if (!raw) return expected;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('channels.')) return expected;
  return trimmed as `channels.${string}`;
}

function configChannelKey(entry: ChannelCatalogEntry | undefined, channelId: string): string {
  const path = entry?.configPath;
  if (path?.startsWith('channels.')) {
    return path.slice('channels.'.length).split('.')[0] || channelId;
  }
  return channelId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function readTextFileIfPresent(filePath: string | undefined): string {
  if (!filePath?.trim()) return '';
  try {
    return readFileSync(filePath.trim(), 'utf8').trim();
  } catch {
    return '';
  }
}

function readJsonFileIfPresent(filePath: string): unknown {
  try {
    if (!existsSync(filePath)) return undefined;
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function resolveTelegramToken(account: Record<string, unknown>): string {
  const inline = typeof account.botToken === 'string' ? account.botToken.trim() : '';
  if (inline) return inline;
  return readTextFileIfPresent(typeof account.tokenFile === 'string' ? account.tokenFile : undefined);
}

function resolveWeixinAccountIds(raw: unknown): string[] {
  const accounts = isRecord(raw) && isRecord(raw.accounts) ? Object.keys(raw.accounts) : [];
  const indexed = readJsonFileIfPresent(join(resolveStateDir(), 'weixin', 'accounts.json'));
  if (!Array.isArray(indexed)) return accounts;
  return [...new Set([
    ...indexed.filter((id): id is string => typeof id === 'string' && id.trim() !== ''),
    ...accounts,
  ])];
}

function hasConfiguredWeixinAccount(raw: unknown): boolean {
  const accounts = isRecord(raw) && isRecord(raw.accounts) ? raw.accounts : {};
  for (const accountId of resolveWeixinAccountIds(raw)) {
    const accountCfg = accounts[accountId];
    if (isRecord(accountCfg) && accountCfg.enabled === false) continue;
    const accountData = readJsonFileIfPresent(join(resolveStateDir(), 'weixin', 'accounts', `${accountId}.json`));
    if (isRecord(accountData) && hasNonEmptyString(accountData.token)) return true;
  }
  return false;
}

function hasConfiguredTelegramCredential(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const accounts = raw.accounts;
  if (!isRecord(accounts)) return false;
  return Object.values(accounts).some((account) => {
    if (!isRecord(account) || account.enabled === false) return false;
    return hasNonEmptyString(resolveTelegramToken(account));
  });
}

function hasConfiguredFeishuCredential(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const hasRootCredentials = hasNonEmptyString(raw.appId) && hasNonEmptyString(raw.appSecret);
  if (hasRootCredentials) return true;
  const accounts = raw.accounts;
  if (!isRecord(accounts)) return false;
  return Object.values(accounts).some((account) => {
    if (!isRecord(account) || account.enabled === false) return false;
    const appId = hasNonEmptyString(account.appId) ? account.appId : raw.appId;
    const appSecret = hasNonEmptyString(account.appSecret) ? account.appSecret : raw.appSecret;
    return hasNonEmptyString(appId) && hasNonEmptyString(appSecret);
  });
}

function issue(params: {
  code: string;
  fieldPath?: string;
  message: string;
  action?: ChannelSetupIssue['action'];
}): ChannelSetupIssue {
  return {
    code: params.code,
    severity: 'required',
    fieldPath: params.fieldPath,
    message: params.message,
    action: params.action ?? 'open_config',
  };
}

function readConfigPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isEmptyConfigValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function schemaFieldTitle(schema: Record<string, unknown>, path: string): string {
  let current: unknown = schema;
  for (const part of path.split('.')) {
    if (!isRecord(current)) break;
    const props = current.properties;
    if (!isRecord(props)) break;
    current = props[part];
  }
  if (isRecord(current) && typeof current.title === 'string' && current.title.trim()) {
    return current.title.trim();
  }
  return path;
}

function collectRequiredSchemaIssues(
  entry: ChannelCatalogEntry | undefined,
  raw: unknown,
): ChannelSetupIssue[] {
  const schema = entry?.configSchema;
  if (!isRecord(schema)) return [];
  const required = schema.required;
  if (!Array.isArray(required)) return [];
  return required
    .map(String)
    .filter((fieldPath) => fieldPath !== 'enabled')
    .filter((fieldPath) => isEmptyConfigValue(readConfigPath(raw, fieldPath)))
    .map((fieldPath) => issue({
      code: 'config.missing_required',
      fieldPath,
      message: `Missing required field: ${schemaFieldTitle(schema, fieldPath)}.`,
    }));
}

function collectChannelSetupIssues(
  id: string,
  raw: unknown,
  entry: ChannelCatalogEntry | undefined,
): ChannelSetupIssue[] {
  if (id === 'telegram' && !hasConfiguredTelegramCredential(raw)) {
    return [issue({
      code: 'telegram.missing_credential',
      fieldPath: 'accounts.default.botToken',
      message: 'Telegram requires at least one enabled account with a Bot Token or token file.',
      action: 'open_config',
    })];
  }
  if (id === 'weixin' && !hasConfiguredWeixinAccount(raw)) {
    return [issue({
      code: 'weixin.missing_account',
      fieldPath: 'accounts',
      message: 'Weixin requires at least one logged-in account before it can run.',
      action: 'run_setup',
    })];
  }
  if ((id === 'feishu' || id === 'lark') && !hasConfiguredFeishuCredential(raw)) {
    return [issue({
      code: 'feishu.missing_credentials',
      fieldPath: 'appId',
      message: 'Feishu/Lark requires App ID and App Secret credentials.',
      action: 'open_config',
    })];
  }
  return collectRequiredSchemaIssues(entry, raw);
}

function hasChannelSetupOutsideConfig(id: string, raw: unknown): boolean {
  return id === 'weixin' && hasConfiguredWeixinAccount(raw);
}

function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function mergeObjectMap<T extends Record<string, unknown>>(base: T | undefined, override: T | undefined): T | undefined {
  if (!base && !override) return undefined;
  if (!base) return override ? withoutUndefined(override) as T : undefined;
  if (!override) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = isRecord(out[key]) && isRecord(value)
      ? { ...out[key], ...withoutUndefined(value) }
      : value;
  }
  return out as T;
}

function mergeRecordDeep(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = isRecord(out[key]) && isRecord(value)
      ? mergeRecordDeep(out[key], value)
      : value;
  }
  return out;
}

function mergeJsonSchema(base: Record<string, unknown> | undefined, override: Record<string, unknown> | undefined) {
  if (!base && !override) return undefined;
  if (!base) return override ? withoutUndefined(override) : undefined;
  if (!override) return base;
  return mergeRecordDeep(base, override);
}

function mergeChannelUi(
  base: ChannelContributionDeclaration['ui'],
  override: ChannelContributionDeclaration['ui'],
): ChannelContributionDeclaration['ui'] {
  if (!base && !override) return undefined;
  return {
    ...(base ?? {}),
    ...(override ?? {}),
    card: mergeObjectMap(base?.card, override?.card),
    modal: mergeObjectMap(base?.modal, override?.modal),
  };
}

function localizeContribution(
  contribution: ChannelContributionDeclaration,
  locale: string | undefined,
): ChannelContributionDeclaration {
  const i18n = contribution.i18n;
  if (!i18n) return contribution;
  const override = localeCandidates(locale).map((key) => i18n[key]).find(Boolean);
  if (!override) return contribution;
  return {
    ...contribution,
    label: override.label ?? contribution.label,
    description: override.description ?? contribution.description,
    configSchema: mergeJsonSchema(contribution.configSchema, override.configSchema),
    uiHints: mergeObjectMap(contribution.uiHints, override.uiHints),
    actions: mergeObjectMap(contribution.actions, override.actions),
    ui: mergeChannelUi(contribution.ui, override.ui),
  };
}

function toCatalogEntry(params: {
  extension: ManifestRegistryEntry;
  channelId: string;
  contribution: ChannelContributionDeclaration;
  locale?: string;
}): ChannelCatalogEntry {
  const contribution = localizeContribution(params.contribution, params.locale);
  const id = normalizeChannelId(params.channelId);
  return {
    id,
    extensionId: params.extension.id,
    source: params.extension.source,
    path: params.extension.path,
    label: contribution.label,
    description: contribution.description,
    docsPath: contribution.docsPath,
    order: contribution.order ?? 999,
    configPath: normalizeConfigPath(id, contribution.configPath),
    capabilities: contribution.capabilities ?? {},
    configSchema: contribution.configSchema ?? DEFAULT_CONFIG_SCHEMA,
    uiHints: contribution.uiHints ?? {},
    actions: contribution.actions ?? {},
    ui: contribution.ui,
  };
}

export function buildChannelCatalogFromSnapshot(
  snapshot: ExtensionMetadataSnapshot,
  options: BuildChannelCatalogOptions = {},
): ChannelCatalog {
  const byId = new Map<string, ChannelCatalogEntry>();
  for (const extension of snapshot.manifestRegistry.getAllEntries()) {
    const contributions = extension.manifest.channelContributions ?? {};
    for (const [channelId, contribution] of Object.entries(contributions)) {
      const entry = toCatalogEntry({ extension, channelId, contribution, locale: options.locale });
      byId.set(entry.id, entry);
    }
  }
  const entries = Array.from(byId.values()).toSorted((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
  return { entries, byId };
}

export function buildChannelCatalogForConfig(config: Config, options: BuildChannelCatalogOptions = {}): ChannelCatalog {
  const snapshot = buildExtensionMetadataSnapshot(resolveExtensionLoaderOptionsFromConfig(config), config);
  return buildChannelCatalogFromSnapshot(snapshot, options);
}

export function getChannelSetupStatus(
  config: Config,
  channelId: string,
  entry?: ChannelCatalogEntry,
): ChannelSetupStatus {
  const id = normalizeChannelId(channelId);
  const configKey = normalizeChannelId(configChannelKey(entry, id));
  const raw = (config.channels as Record<string, unknown> | undefined)?.[configKey];
  const enabled = isRecord(raw) && raw.enabled === true;
  const issues = collectChannelSetupIssues(id, raw, entry);
  const hasAnyConfig = isRecord(raw) ? Object.keys(raw).some((key) => key !== 'enabled') : Boolean(raw);
  const ready = issues.length === 0 && (enabled || hasAnyConfig || hasChannelSetupOutsideConfig(id, raw));
  return {
    enabled,
    ready,
    state: enabled ? (ready ? 'ready' : 'needs_setup') : 'disabled',
    issues,
  };
}

export function isChannelConfigured(config: Config, channelId: string): boolean {
  return getChannelSetupStatus(config, channelId).ready;
}

export function getConfiguredChannelIds(config: Config): string[] {
  return Object.keys(config.channels ?? {})
    .map(normalizeChannelId)
    .filter((id) => id && isChannelConfigured(config, id));
}
