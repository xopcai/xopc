import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { resolvePluginCapabilityAccess } from './capability-access.js';
import { AgentPluginStore, type InstalledAgentPlugin } from './store.js';
import { PluginSetupService } from './setup.js';
import { pluginAuthorizations } from './setup-contract.js';

const log = createLogger('PluginRuntimeAccess');
const refreshIntervalMs = 60_000;
const refreshes = new Map<string, Promise<void>>();

export type PluginMcpOrigin = { id: string; revision: string; serverName: string };

function refreshPlugin(config: Config, store: AgentPluginStore, plugin: InstalledAgentPlugin, workspace: string): Promise<void> {
  if (!pluginAuthorizations(plugin.manifest).length && !Object.values(plugin.layout?.userConfig ?? {}).some(field => field.sensitive)
    && Object.values(plugin.servers).every(server => server.type === 'stdio' || server.connectionAuth?.mode === 'none')) return Promise.resolve();

  const key = JSON.stringify([plugin.id, plugin.receipt.revision]);
  const current = refreshes.get(key);
  if (current) return current;

  const refresh = new PluginSetupService(store).refreshRuntime(plugin.id, config, workspace)
    .finally(() => {
      setTimeout(() => refreshes.delete(key), refreshIntervalMs).unref();
    });
  refreshes.set(key, refresh);
  return refresh;
}

export function schedulePluginRuntimeAccessRefresh(config: Config, workspace: string, agentId?: string): void {
  setImmediate(() => {
    const store = new AgentPluginStore();
    void Promise.resolve().then(() => Promise.all(store.active(agentId, workspace).map(async plugin => {
      try { await refreshPlugin(config, store, plugin, workspace); }
      catch (err) { log.warn({ err, pluginId: plugin.id }, 'Could not refresh plugin authorization state'); }
    }))).catch(err => log.warn({ err }, 'Could not list plugins for authorization refresh'));
  }).unref();
}

export async function assertPluginMcpCallAccess(config: Config, workspace: string, origin: PluginMcpOrigin): Promise<void> {
  const store = new AgentPluginStore();
  const allowedPlugin = () => store.active(undefined, workspace).find(plugin => plugin.id === origin.id
    && plugin.receipt.revision === origin.revision && resolvePluginCapabilityAccess(plugin, store).server(origin.serverName));
  const plugin = allowedPlugin();
  if (!plugin) throw new Error('Plugin tool authorization is unavailable. Check the plugin connection.');
  await refreshPlugin(config, store, plugin, workspace);
  if (!allowedPlugin()) throw new Error('Plugin tool authorization changed. Check the plugin connection.');
}
