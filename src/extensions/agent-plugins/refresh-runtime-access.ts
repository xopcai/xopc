import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { resolvePluginCapabilityAccess } from './capability-access.js';
import { AgentPluginStore } from './store.js';
import { PluginSetupService } from './setup.js';
import { pluginAuthorizations } from './setup-contract.js';

const log = createLogger('PluginRuntimeAccess');

/** Check provider-defined credentials before constructing a new turn's Skill index and MCP config. */
export async function refreshPluginRuntimeAccess(config: Config, workspace: string, agentId?: string): Promise<boolean> {
  const store = new AgentPluginStore(), service = new PluginSetupService(store);
  const signature = () => JSON.stringify(store.active(agentId, workspace).map(plugin => {
    const access = resolvePluginCapabilityAccess(plugin, store);
    return [plugin.id, plugin.skills.filter(s => access.skill(s.name)).map(s => s.name), Object.keys(plugin.servers).filter(access.server)];
  }));
  const before = signature();
  for (const plugin of store.active(agentId, workspace)) {
    if (!pluginAuthorizations(plugin.manifest).length && !Object.values(plugin.layout?.userConfig ?? {}).some(field => field.sensitive) && Object.values(plugin.servers).every(server => server.type === 'stdio' || server.connectionAuth?.mode === 'none')) continue;
    try { await service.refreshRuntime(plugin.id, config, workspace); }
    catch (err) { log.warn({ err, pluginId: plugin.id }, 'Could not refresh plugin authorization state'); }
  }
  return before !== signature();
}
