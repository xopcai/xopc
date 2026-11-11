import { storeConnectorCandidateRef } from '../../capabilities/store-connector.js';
import type { Config } from '../../config/schema.js';
import { getConnectorDefinition, listConnectorCatalog } from '../../connectors/catalog.js';
import { connectionCandidates } from '../../connectors/connection-candidates.js';
import { isExcludedStoreConnector, preferredStorePlugin } from '../../connectors/excluded-connectors.js';
import { listConnectorInstances } from '../../connectors/instances.js';
import { AgentPluginStore } from '../../extensions/agent-plugins/store.js';
import { listIntegrationPackages, resolveExtensionsStoreBaseUrl, resolveSkillsStoreBaseUrl } from '../skills/marketplace/adapters/store/store-api-client.js';

export type ManagedMatch = { label: string; kind: 'plugin' | 'connector'; managementPath: string; candidateRef?: string };

function matches(serviceName: string, ...names: Array<string | undefined>) {
  const normalize = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const target = normalize(serviceName);
  return Boolean(target) && names.some(name => name && normalize(name) === target);
}

export async function findManagedMcpIntegrations(config: Config, serviceName: string, signal?: AbortSignal, includeInstalled = true): Promise<ManagedMatch[]> {
  const pluginPackage = preferredStorePlugin(serviceName);
  const installed = (includeInstalled ? new AgentPluginStore().list() : []).filter(plugin =>
    matches(serviceName, plugin.id, plugin.manifest.name, plugin.receipt.provenance?.packageName)
    || Boolean(pluginPackage && [plugin.id, plugin.receipt.provenance?.packageName].includes(pluginPackage)));
  if (installed.length) return installed.map(plugin => ({
    label: plugin.manifest.name, kind: 'plugin', candidateRef: `agent-plugin:${plugin.id}`,
    managementPath: `/capabilities/extensions?tab=user&plugin=${encodeURIComponent(plugin.id)}`,
  }));

  const instances = includeInstalled ? listConnectorInstances(config) : [];
  const connected = instances.filter(instance => matches(serviceName, instance.connectorId, instance.displayName,
    getConnectorDefinition(instance.connectorId)?.displayName));
  if (connected.length) return connected.map(instance => ({
    kind: 'connector', label: instance.displayName ?? instance.connectorId,
    managementPath: `/capabilities/connectors?tab=connected&instance=${encodeURIComponent(instance.instanceId)}`,
  }));

  if (pluginPackage) return [{
    kind: 'plugin', label: serviceName, candidateRef: `store-plugin:${pluginPackage}`,
    managementPath: `/capabilities/extensions?tab=marketplace&q=${encodeURIComponent(pluginPackage)}`,
  }];

  const builtin = listConnectorCatalog().filter(entry =>
    matches(serviceName, entry.id, entry.displayName, entry.runtime.type === 'composio' ? entry.runtime.toolkit : undefined));
  if (builtin.length) {
    const supported = new Set(connectionCandidates(serviceName).map(candidate => candidate.candidateRef));
    return builtin.map(entry => ({
      kind: 'connector', label: entry.displayName, ...(supported.has(entry.id) ? { candidateRef: entry.id } : {}),
      managementPath: `/capabilities/connectors?tab=discover&connector=${encodeURIComponent(entry.id)}`,
    }));
  }

  const catalogSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000);
  const results = await Promise.allSettled((['plugin', 'connector'] as const).map(async kind => {
    const base = kind === 'plugin' ? resolveExtensionsStoreBaseUrl(config) : resolveSkillsStoreBaseUrl(config);
    const { items } = await listIntegrationPackages(base, { q: serviceName, page: 1, pageSize: 20 }, { type: kind, signal: catalogSignal });
    return items.flatMap((item): ManagedMatch[] => {
      if (item.type !== kind || !item.latestVersion || kind === 'connector' && isExcludedStoreConnector(item.name)) return [];
      const manifest = item.connectorManifest as { displayName?: unknown } | undefined;
      const label = typeof manifest?.displayName === 'string' ? manifest.displayName : item.localizations?.en?.displayName ?? item.name;
      if (!matches(serviceName, item.name, label, item.localizations?.['zh-CN']?.displayName)) return [];
      return [{ kind, label, ...(kind === 'plugin'
        ? { candidateRef: `store-plugin:${item.name}`, managementPath: `/capabilities/extensions?tab=marketplace&q=${encodeURIComponent(item.name)}` }
        : { managementPath: `/capabilities/connectors?tab=discover&storeConnector=${encodeURIComponent(item.name)}`,
          candidateRef: storeConnectorCandidateRef(item.name, item.latestVersion) }) }];
    });
  }));
  signal?.throwIfAborted();
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}
