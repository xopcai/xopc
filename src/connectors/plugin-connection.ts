import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ConnectionNeed, ConnectionNeedView, PluginConnectionTarget } from '@xopcai/gateway-contract';

import { resolveAgentWorkspaceDir } from '../agent/agent-scope.js';
import { fetchMarketplacePackageDetail, resolveExtensionsStoreBaseUrl } from '../agent/skills/marketplace/adapters/store/store-api-client.js';
import type { Config } from '../config/schema.js';
import { resolvePluginCapabilityAccess } from '../extensions/agent-plugins/capability-access.js';
import { agentPluginInventoryRow } from '../extensions/agent-plugins/inventory.js';
import { PluginSetupService } from '../extensions/agent-plugins/setup.js';
import { AgentPluginStore } from '../extensions/agent-plugins/store.js';

export async function resolvePluginConnectionCandidate(ref: string, config?: Config): Promise<ConnectionNeed | undefined> {
  const installed = /^agent-plugin:([a-z0-9.-]+)$/.exec(ref)?.[1];
  if (installed) {
    const plugin = new AgentPluginStore().get(installed);
    if (!plugin) throw new Error('The requested plugin is no longer installed.');
    return { key: ref, label: plugin.manifest.name, capabilities: ['tools'],
      target: { type: 'plugin', pluginId: installed, revision: plugin.receipt.revision }, unavailable: true };
  }
  const packageName = /^store-plugin:([a-z0-9.-]+)$/.exec(ref)?.[1];
  if (!packageName) return undefined;
  if (!config) throw new Error('The Store is unavailable in this session.');
  const detail = await fetchMarketplacePackageDetail(resolveExtensionsStoreBaseUrl(config), packageName, AbortSignal.timeout(6000));
  if (detail.type !== 'plugin' || !detail.latestVersion?.version) throw new Error('No matching plugin is available in the Store.');
  return { key: ref, label: detail.localizations?.en?.displayName ?? packageName, capabilities: ['tools'],
    target: { type: 'plugin', packageName, version: detail.latestVersion.version }, unavailable: true };
}

export function readPluginConnection(need: ConnectionNeed & { target: PluginConnectionTarget }, agentId: string): {
  view: ConnectionNeedView; revision?: string; verified: boolean;
} {
  const { target } = need;
  const base = { ...need, authorizationMode: 'desktop' as const, accounts: [] };
  const blocked = (reason: string): { view: ConnectionNeedView; verified: false } => ({
    view: { ...base, phase: 'blocked', reason }, verified: false,
  });
  try {
    const store = new AgentPluginStore();
    const plugin = 'pluginId' in target ? store.get(target.pluginId)
      : store.list().find(item => item.receipt.provenance?.packageName === target.packageName);
    if (!plugin) return 'packageName' in target
      ? { view: { ...base, phase: 'install' }, verified: false }
      : blocked('The plugin is no longer installed.');
    const exact = 'pluginId' in target ? plugin.receipt.revision === target.revision
      : plugin.receipt.provenance?.version === target.version;
    if (!exact || plugin.readiness === 'blocked' || store.pending(plugin.id)) {
      return blocked('The plugin has changed or is unavailable. Review it in the plugin manager.');
    }
    const workspace = resolveAgentWorkspaceDir(agentId);
    const scope = plugin.receipt.workspacePaths;
    if (scope && !scope.includes(existsSync(workspace) ? realpathSync(workspace) : resolve(workspace))) {
      return blocked('The plugin is unavailable in this workspace. Review its workspace access in the plugin manager.');
    }

    const inventory = agentPluginInventoryRow(plugin, store);
    const job = new PluginSetupService(store).get(plugin.id, 'gateway-owner');
    const setup = job?.packageRevision === plugin.receipt.revision ? job : undefined;
    const revision = JSON.stringify([plugin.receipt.revision, plugin.receipt.enabled, setup?.id, setup?.revision]);
    const active = store.active(agentId, workspace).some(item => item.id === plugin.id && item.receipt.revision === plugin.receipt.revision);
    const access = resolvePluginCapabilityAccess(plugin, store);
    const usable = plugin.skills.some(skill => access.skill(skill.name))
      || Object.keys(plugin.servers).some(name => access.server(name) && (!setup || setup.connections.some(item => item.name === name && (item.toolCount ?? 0) > 0)));
    // A runtime refresh can leave a healthy installed job in action_required.
    const finished = !setup || !setup.deferred && (setup.state === 'completed'
      || Boolean(need.connectionId) && setup.installed && setup.resources === 'ready' && setup.state === 'action_required');
    const setupVerified = active && usable && inventory.authorizationStatus !== 'required' && finished;
    // An existing setup result cannot satisfy a new request to repair that connection.
    const freshSetup = need.attempt && (!setup || need.attempt.connectionId !== revision);
    const verified = setupVerified && (!need.unavailable || Boolean(freshSetup));
    const phase = verified ? 'ready' : setup?.state === 'running' ? 'authorizing'
      : plugin.receipt.enabled && (need.unavailable || inventory.authorizationStatus === 'required') ? 'reconnect' : 'connect';
    return { revision, verified, view: { ...base, pluginId: plugin.id, phase } };
  } catch {
    return blocked('The plugin setup state is unavailable. Review it in the plugin manager.');
  }
}
