import type {
  ConnectorDefinition,
  ConnectorInstance,
  StoreConnectorCatalogItem,
} from '@/features/connectors/connectors-api';
import type { ExtensionMarketplaceItem } from '@/features/extensions/extension-marketplace-api';
import type { MarketplacePackageItem, SkillCatalogEntry } from '@/features/skills/skill.types';

export type CapabilityKind = 'skill' | 'connector' | 'extension';
export type CapabilityStatus = 'available' | 'installed' | 'attention';

export type CapabilityCatalogItem = {
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  source: string;
  status: CapabilityStatus;
  tags: string[];
  href: string;
  iconUrl?: string;
};

function storeConnectorIcon(connector: StoreConnectorCatalogItem): string | undefined {
  const manifest = connector.connectorManifest;
  if (!manifest || typeof manifest !== 'object') return undefined;
  const branding = 'branding' in manifest ? manifest.branding : undefined;
  if (!branding || typeof branding !== 'object') return undefined;
  const logoUrl = 'logoUrl' in branding ? branding.logoUrl : undefined;
  return typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl : undefined;
}

function includesQuery(item: CapabilityCatalogItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [item.name, item.description, item.source, ...item.tags]
    .some(value => value.toLocaleLowerCase().includes(needle));
}

function connectorStatus(instance: ConnectorInstance | undefined): CapabilityStatus {
  if (!instance) return 'available';
  return ['failed', 'unauthorized', 'degraded', 'not_configured'].includes(instance.status)
    ? 'attention'
    : 'installed';
}

export function filterCapabilityCatalog(
  items: CapabilityCatalogItem[],
  kind: CapabilityKind | 'all',
  query: string,
): CapabilityCatalogItem[] {
  return items.filter(item => (kind === 'all' || item.kind === kind) && includesQuery(item, query));
}

export function skillCapabilityItems(
  marketplace: MarketplacePackageItem[],
  installed: SkillCatalogEntry[],
): CapabilityCatalogItem[] {
  const installedIds = new Set(installed.flatMap(skill => [skill.directoryId, skill.name]));
  return marketplace.map(skill => ({
    id: skill.id,
    kind: 'skill',
    name: skill.name,
    description: skill.description,
    source: skill.sourceLabel || skill.author.username,
    status: installedIds.has(skill.id) || installedIds.has(skill.name) ? 'installed' : 'available',
    tags: [skill.category, ...(skill.categories ?? []), ...(skill.tags ?? [])].filter((tag): tag is string => Boolean(tag)),
    href: `/capabilities/skills?tab=marketplace&q=${encodeURIComponent(skill.name)}`,
  }));
}

export function connectorCapabilityItems(
  definitions: ConnectorDefinition[],
  marketplace: StoreConnectorCatalogItem[],
  instances: ConnectorInstance[],
): CapabilityCatalogItem[] {
  const instanceByConnector = new Map(instances.map(instance => [instance.connectorId, instance]));
  const items = new Map<string, CapabilityCatalogItem>();

  for (const connector of definitions) {
    const instance = instanceByConnector.get(connector.id);
    items.set(connector.id, {
      id: connector.id,
      kind: 'connector',
      name: connector.displayName,
      description: connector.description,
      source: connector.source,
      status: connectorStatus(instance),
      tags: [connector.category, connector.kind, ...(connector.tags ?? [])],
      href: `/capabilities/connectors?tab=${instance ? 'connected' : 'discover'}&${instance ? 'instance' : 'connector'}=${encodeURIComponent(instance?.instanceId ?? connector.id)}`,
      iconUrl: connector.branding?.logoUrl,
    });
  }

  for (const connector of marketplace) {
    if (items.has(connector.id)) continue;
    const instance = instanceByConnector.get(connector.id);
    items.set(connector.id, {
      id: connector.id,
      kind: 'connector',
      name: connector.name,
      description: connector.description,
      source: connector.author.username || 'XOPC Store',
      status: connectorStatus(instance),
      tags: [connector.category].filter((tag): tag is string => Boolean(tag)),
      href: `/capabilities/connectors?tab=discover&connector=${encodeURIComponent(connector.id)}`,
      iconUrl: storeConnectorIcon(connector),
    });
  }

  return [...items.values()];
}

export function extensionCapabilityItems(
  marketplace: ExtensionMarketplaceItem[],
  installedIds: Set<string>,
): CapabilityCatalogItem[] {
  return marketplace.map(extension => ({
    id: extension.id,
    kind: 'extension',
    name: extension.name,
    description: extension.description ?? '',
    source: extension.author || extension.npmPackage,
    status: installedIds.has(extension.id) ? 'installed' : 'available',
    tags: [...(extension.categories ?? []), ...(extension.tags ?? [])],
    href: `/capabilities/extensions?tab=marketplace&q=${encodeURIComponent(extension.name)}`,
  }));
}
