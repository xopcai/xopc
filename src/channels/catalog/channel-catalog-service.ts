import type { Config } from '../../config/schema.js';
import {
  buildExtensionMetadataSnapshot,
  resolveExtensionLoaderOptionsFromConfig,
} from '../../extensions/extension-metadata-snapshot.js';
import type { ExtensionMetadataSnapshot } from '../../extensions/extension-metadata-snapshot.js';
import type { ManifestRegistryEntry } from '../../extensions/manifest-registry.js';
import type { ChannelContributionDeclaration } from '../../extensions/types/manifest.js';

import type { ChannelCatalog, ChannelCatalogEntry } from './channel-catalog-types.js';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasConfiguredTelegramCredential(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (hasNonEmptyString(raw.botToken) || hasNonEmptyString(raw.tokenFile)) return true;
  const accounts = raw.accounts;
  if (!isRecord(accounts)) return false;
  return Object.values(accounts).some((account) => {
    if (!isRecord(account) || account.enabled === false) return false;
    return hasNonEmptyString(account.botToken) || hasNonEmptyString(account.tokenFile);
  });
}

function hasConfiguredWeixinAccount(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (raw.enabled === true) return true;
  const accounts = raw.accounts;
  if (!isRecord(accounts)) return false;
  return Object.values(accounts).some((account) => isRecord(account) && account.enabled !== false);
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

export function isChannelConfigured(config: Config, channelId: string): boolean {
  const id = normalizeChannelId(channelId);
  const raw = (config.channels as Record<string, unknown> | undefined)?.[id];
  if (!raw) return false;
  if (id === 'telegram') return hasConfiguredTelegramCredential(raw);
  if (id === 'weixin') return hasConfiguredWeixinAccount(raw);
  return isRecord(raw) ? raw.enabled === true || Object.keys(raw).length > 0 : true;
}

export function getConfiguredChannelIds(config: Config): string[] {
  return Object.keys(config.channels ?? {})
    .map(normalizeChannelId)
    .filter((id) => id && isChannelConfigured(config, id));
}
