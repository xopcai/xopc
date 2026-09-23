import { resolve } from 'node:path';
import { AgentPluginStore, type InstalledAgentPlugin } from './store.js';
import { containedPath, expandPluginVariables, pluginServerId, resolvePluginCwd, type PluginDiagnostic } from './validation.js';
import { applyPluginAuthBinding, readPluginAuthBinding } from './auth.js';

export function materializePluginServers(plugin: InstalledAgentPlugin, store = new AgentPluginStore(), diagnostics: PluginDiagnostic[] = []): Record<string, Record<string, unknown>> {
  const root = plugin.rootDir;
  const data = store.dataDir(plugin.id);
  const servers: Record<string, Record<string, unknown>> = Object.create(null);
  for (const [name, server] of Object.entries(plugin.servers)) {
    try {
      const origin = { id: plugin.id, serverName: name, rootDir: root, dataDir: data, revision: plugin.receipt.revision };
      const raw = server.type !== 'stdio' ? {
        ...server, xopcPlugin: origin,
        ...(server.type === 'streamable-http' && !Object.keys(server.headers ?? {}).some(key => key.toLowerCase() === 'authorization')
          ? { auth: { type: 'oauth' }, xopcAutoAuth: true } : {}),
      } : {
        type: 'stdio', xopcPlugin: origin,
        command: server.command.startsWith('./') ? containedPath(root, resolve(root, server.command)) : server.command,
        args: server.args?.map(value => expandPluginVariables(value, root, data)),
        env: { ...Object.fromEntries(Object.entries(server.env ?? {}).map(([key, value]) => [key, expandPluginVariables(value, root, data)])), PLUGIN_ROOT: root, PLUGIN_DATA: data },
        cwd: resolvePluginCwd(server.cwd, root, data),
      };
      servers[pluginServerId(plugin.id, name)] = applyPluginAuthBinding(raw, readPluginAuthBinding(store, plugin.id, name, server));
    } catch (error) {
      diagnostics.push({ component: `mcp:${name}`, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return servers;
}
