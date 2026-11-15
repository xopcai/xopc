import { listAgentEntries, resolveDefaultAgentId } from '../agent/agent-scope.js';
import { listStoreConnectorCatalog } from '../capabilities/store-connector.js';
import { isBundledChannelExtension } from '../channels/bundled-channel-extensions.js';
import { buildChannelCatalogForConfig, buildChannelCatalogFromSnapshot, getChannelSetupStatus } from '../channels/catalog/channel-catalog-service.js';
import { listConnectorCatalog } from '../connectors/catalog.js';
import { listConnectorInstances } from '../connectors/instances.js';
import { projectComposioConnectionStatus } from '../connectors/runtime-status.js';
import { listAgentPluginInventory } from '../extensions/agent-plugins/inventory.js';
import { fetchRegistry } from '../extensions/marketplace.js';
import { personalAgentId } from '../personal-agent/repository.js';
import { listConnectorConnections } from '../storage/sqlite/connector-repository.js';
import type { Config } from '../config/schema.js';
import { buildExtensionMetadataSnapshot, resolveExtensionLoaderOptionsFromConfig, type ExtensionMetadataSnapshot } from '../extensions/extension-metadata-snapshot.js';
import { isManagedConnectorServer } from '../connectors/materialize.js';

export const mobileCapabilityCategories = ['plugins', 'skills', 'connections', 'agents', 'channels'] as const;
export type MobileCapabilityCategory = typeof mobileCapabilityCategories[number];

type Group = 'installed' | 'available' | 'connected' | 'configured' | 'disabled' | 'attention' | 'assistant' | 'expert';

export type MobileCapabilityRow = {
  id: string;
  name: string;
  description?: string;
  group: Group;
  avatar?: string;
  version?: string;
  targetId?: string;
  issue?: string;
};

export type CapabilityCatalogPage = {
  items: MobileCapabilityRow[];
  incomplete?: boolean;
};

type Locale = 'en' | 'zh-CN';

export type CapabilityCatalogSource = {
  config: Config;
  extensions?: ReadonlyArray<{ id: string; manifest: { id: string; name: string; description?: string; version?: string } }>;
  skills: ReadonlyArray<{ directoryId: string; name: string; description?: string; enabled?: boolean;
    localizations?: Partial<Record<Locale, { displayName?: string; description?: string }>> }>;
  channelSnapshot?: ExtensionMetadataSnapshot;
  runningChannels?: ReadonlySet<string>;
};

export type CapabilityChannelState = Pick<CapabilityCatalogSource, 'channelSnapshot' | 'runningChannels'>;

async function plugins(source: CapabilityCatalogSource, locale: Locale): Promise<CapabilityCatalogPage> {
  const installed = new Map<string, MobileCapabilityRow>();
  const discovered = source.extensions ?? source.channelSnapshot?.discovered
    ?? buildExtensionMetadataSnapshot(resolveExtensionLoaderOptionsFromConfig(source.config), source.config).discovered;
  for (const extension of discovered) {
    if (isBundledChannelExtension(extension.id)) continue;
    const { id, name, description, version } = extension.manifest;
    installed.set(id, { id, name, description, version, group: 'installed' });
  }
  for (const plugin of listAgentPluginInventory()) {
    const id = plugin.provenance?.packageName ?? plugin.pluginId;
    const labels = plugin.localizations?.[locale];
    installed.set(id, {
      id, name: labels?.displayName ?? plugin.name, description: labels?.description ?? plugin.description,
      version: plugin.version,
      group: plugin.installationState === 'preparing' || plugin.authorizationStatus === 'required'
        || plugin.readiness === 'blocked' || plugin.readiness === 'setup_required' ? 'attention'
        : plugin.activationEligible === false ? 'disabled' : 'installed',
      ...(id !== plugin.pluginId ? { targetId: plugin.pluginId } : {}),
    });
  }

  const { extensions } = await fetchRegistry();
  const available = extensions.flatMap((entry): MobileCapabilityRow[] => {
    if (entry.packageType !== 'plugin' || installed.has(entry.id)) return [];
    const labels = entry.localizations?.[locale];
    return [{ id: entry.id, name: labels?.displayName ?? entry.name,
      description: labels?.description ?? entry.description, version: entry.version, group: 'available' }];
  });
  return { items: [...installed.values(), ...available] };
}

async function connections(config: Config, locale: Locale): Promise<CapabilityCatalogPage> {
  const definitions = new Map(listConnectorCatalog().map(entry => [entry.id, entry]));
  const instances = projectComposioConnectionStatus(
    listConnectorInstances(config), listConnectorConnections({ principalId: 'local-owner' }),
  );
  const rows = new Map<string, MobileCapabilityRow>();
  for (const instance of instances) {
    const id = instance.connectorId;
    const connected = instance.enabled && (instance.status === 'connected' || instance.connectionStatus === 'connected');
    const group = connected ? 'connected' : !instance.enabled ? 'disabled'
      : ['unauthorized', 'error'].includes(instance.connectionStatus) || instance.authStatus === 'missing'
        ? 'attention' : 'configured';
    const priority = ['disabled', 'attention', 'configured', 'connected'];
    if (priority.indexOf(rows.get(id)?.group ?? '') >= priority.indexOf(group)) continue;
    rows.set(id, { id, name: instance.displayName, description: definitions.get(id)?.description, group });

  }
  for (const entry of definitions.values()) {
    if (!rows.has(entry.id)) rows.set(entry.id, { id: entry.id, name: entry.displayName, description: entry.description, group: 'available' });
  }

  for (const [targetId, server] of Object.entries(config.mcp?.servers ?? {})) {
    if (isManagedConnectorServer(server)) continue;
    const id = 'mcp:' + targetId;
    rows.set(id, { id, targetId, name: targetId, group: server.enabled === false ? 'disabled' : 'configured' });
  }

  try {
    const store = await listStoreConnectorCatalog(config, { sort: 'downloads' });
    for (const entry of store) {
      if (rows.has(entry.name)) continue;
      const labels = entry.localizations?.[locale];
      rows.set(entry.name, {
        id: entry.name, name: labels?.displayName ?? entry.name, description: labels?.description ?? entry.description, group: 'available',
      });
    }
  } catch {
    return { items: [...rows.values()], incomplete: true };
  }
  return { items: [...rows.values()] };
}

export async function listCapabilities(source: CapabilityCatalogSource, category: MobileCapabilityCategory, language: string): Promise<CapabilityCatalogPage> {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  switch (category) {
    case 'plugins':
      return plugins(source, locale);
    case 'skills':
      return { items: source.skills.map(entry => ({
        id: entry.directoryId, name: entry.localizations?.[locale]?.displayName ?? entry.name,
        description: entry.localizations?.[locale]?.description ?? entry.description,
        group: entry.enabled === false ? 'disabled' : 'installed',
      })) };
    case 'connections':
      return connections(source.config, locale);
    case 'agents': {
      const defaultId = resolveDefaultAgentId();
      const personalId = personalAgentId('local-owner');
      const items = listAgentEntries().filter(agent => agent.id !== personalId)
        .sort((first, second) => first.id.localeCompare(second.id))
        .map((agent): MobileCapabilityRow => ({
          id: agent.id, name: agent.profile?.name ?? agent.id, description: agent.profile?.description,
          avatar: agent.profile?.avatar, group: agent.enabled === false ? 'disabled' : agent.id === defaultId ? 'assistant' : 'expert',
        }));
      return { items };
    }
    case 'channels': {
      const { config, channelSnapshot, runningChannels } = source;
      const { entries } = channelSnapshot
        ? buildChannelCatalogFromSnapshot(channelSnapshot, { locale })
        : buildChannelCatalogForConfig(config, { locale });
      return { items: entries.map(entry => {
        const status = getChannelSetupStatus(config, entry.id, entry);
        const running = runningChannels?.has(entry.id) ?? false;
        const { code } = status.issues[0] ?? {};
        return { id: entry.id, name: entry.label, description: entry.description,
          group: running && status.enabled ? 'connected' : status.enabled
            ? status.ready ? (runningChannels ? 'attention' : 'configured') : 'attention'
            : status.ready ? 'disabled' : 'available',
          issue: code,
        };
      }) };
    }
  }
}
