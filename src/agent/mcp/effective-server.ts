import type { Config } from '../../config/schema.js';
import { AgentPluginStore } from '../../extensions/agent-plugins/store.js';
import { materializePluginServers } from '../../extensions/agent-plugins/mcp-adapter.js';

/** Resolve a single explicit setup target without enabling it for any agent. */
export function resolveMcpSetupConfig(config: Config, serverId: string): Config {
  if (Object.hasOwn(config.mcp?.servers ?? {}, serverId)) return config;
  const store = new AgentPluginStore();
  for (const installed of store.list()) {
    const plugin = store.pending(installed.id) ?? installed;
    if (plugin.readiness === 'blocked') continue;
    const servers = materializePluginServers(plugin, store, [], true);
    if (!Object.hasOwn(servers, serverId)) continue;
    return { ...config, mcp: { ...config.mcp, servers: { ...config.mcp?.servers, [serverId]: servers[serverId] } } } as Config;
  }
  return config;
}
