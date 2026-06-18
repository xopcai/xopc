import type { Config } from '../../config/schema.js';
import {
  buildExtensionMetadataSnapshot,
  resolveExtensionLoaderOptionsFromConfig,
} from '../../extensions/extension-metadata-snapshot.js';
import type { ExtensionMetadataSnapshot } from '../../extensions/extension-metadata-snapshot.js';
import type { ManifestRegistryEntry } from '../../extensions/manifest-registry.js';
import type { ChannelContributionDeclaration } from '../../extensions/types/manifest.js';

import type { ChannelCatalog, ChannelCatalogEntry } from './channel-catalog-types.js';

const DEFAULT_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true,
};

function normalizeChannelId(raw: string): string {
  return raw.trim().toLowerCase();
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

function toCatalogEntry(params: {
  extension: ManifestRegistryEntry;
  channelId: string;
  contribution: ChannelContributionDeclaration;
}): ChannelCatalogEntry {
  const id = normalizeChannelId(params.channelId);
  return {
    id,
    extensionId: params.extension.id,
    source: params.extension.source,
    path: params.extension.path,
    label: params.contribution.label,
    description: params.contribution.description,
    docsPath: params.contribution.docsPath,
    order: params.contribution.order ?? 999,
    configPath: normalizeConfigPath(id, params.contribution.configPath),
    capabilities: params.contribution.capabilities ?? {},
    configSchema: params.contribution.configSchema ?? DEFAULT_CONFIG_SCHEMA,
    uiHints: params.contribution.uiHints ?? {},
    actions: params.contribution.actions ?? {},
  };
}

export function buildChannelCatalogFromSnapshot(snapshot: ExtensionMetadataSnapshot): ChannelCatalog {
  const byId = new Map<string, ChannelCatalogEntry>();
  for (const extension of snapshot.manifestRegistry.getAllEntries()) {
    const contributions = extension.manifest.channelContributions ?? {};
    for (const [channelId, contribution] of Object.entries(contributions)) {
      const entry = toCatalogEntry({ extension, channelId, contribution });
      byId.set(entry.id, entry);
    }
  }
  const entries = Array.from(byId.values()).toSorted((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
  return { entries, byId };
}

export function buildChannelCatalogForConfig(config: Config): ChannelCatalog {
  const snapshot = buildExtensionMetadataSnapshot(resolveExtensionLoaderOptionsFromConfig(config), config);
  return buildChannelCatalogFromSnapshot(snapshot);
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
