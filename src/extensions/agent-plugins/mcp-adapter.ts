import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readPluginUserConfig, expandUserConfig } from './user-config.js';
import { AgentPluginStore, type InstalledAgentPlugin } from './store.js';
import { containedPath, expandPluginVariables, pluginServerId, resolvePluginCwd, type PluginDiagnostic } from './validation.js';
import { applyPluginAuthBinding, readPluginAuthBinding } from './auth.js';

export function pluginOAuthCredentialId(pluginId: string, revision: string, serverName: string): string {
  return `mcp_draft_${createHash('sha256').update(JSON.stringify(['plugin', pluginId, revision, serverName])).digest('hex').slice(0, 32)}`;
}

export function materializePluginServers(plugin: InstalledAgentPlugin, store = new AgentPluginStore(), diagnostics: PluginDiagnostic[] = [], setup = false): Record<string, Record<string, unknown>> {
  const root = plugin.rootDir;
  const data = store.dataDir(plugin.id);
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const values = { ...Object.fromEntries(Object.entries(plugin.layout?.userConfig ?? {}).filter(([, field]) => field.default !== undefined).map(([key, field]) => [key, field.default])), ...readPluginUserConfig(store, plugin.id, plugin.receipt.revision) };
  const expand = (value: string) => expandUserConfig(expandPluginVariables(value.replace(/\$\{PLUGIN_ACCOUNTS\}/g, join(data, 'accounts', plugin.receipt.revision)).replace(/\$\{PLUGIN_RESOURCES\}/g, join(data, 'resources', plugin.receipt.revision)), root, data), values);
  const servers: Record<string, Record<string, unknown>> = Object.create(null);
  const setupPath = join(store.stateDir, 'plugin-setup', `${plugin.id}.json`);
  const job = !setup && existsSync(setupPath) ? JSON.parse(readFileSync(setupPath, 'utf8')) as { packageRevision: string; state: string; installed?: boolean; connections: Array<{ name: string; state: string }> } : undefined;
  for (const [name, server] of Object.entries(plugin.servers)) {
    try {
      if (job?.packageRevision === plugin.receipt.revision && (job.state !== 'completed' && !job.installed || job.connections.find(c => c.name === name)?.state !== 'connected')) continue;
      const origin = { id: plugin.id, serverName: name, rootDir: root, dataDir: data, revision: plugin.receipt.revision };
      const raw = server.type !== 'stdio' ? {
        ...server, ...(plugin.receipt.credentialScope === 'revision' ? { xopcOAuthCredentialId: pluginOAuthCredentialId(plugin.id, plugin.receipt.revision, name) } : {}), ...(server.headers ? { headers: Object.fromEntries(Object.entries(server.headers).map(([key, value]) => [key, expand(value)])) } : {}), xopcPlugin: origin,
      } : {
        type: 'stdio', xopcPlugin: origin,
        command: server.command.startsWith('./') ? containedPath(root, resolve(root, server.command)) : server.command.startsWith('${PLUGIN_RESOURCES}/') ? containedPath(data, join(data, 'resources', plugin.receipt.revision, server.command.slice('${PLUGIN_RESOURCES}/'.length))) : server.command,
        args: server.args?.map(value => { const expanded = expand(value); if (typeof expanded !== 'string') throw new Error('Sensitive arguments are not supported; use environment variables'); return expanded; }),
        env: { ...Object.fromEntries(Object.entries(server.env ?? {}).map(([key, value]) => [key, expand(value)])), PLUGIN_HOST_HOME: homedir(), PLUGIN_ROOT: root, PLUGIN_DATA: data, PLUGIN_RESOURCES: join(data, 'resources', plugin.receipt.revision), CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data },
        cwd: resolvePluginCwd(server.cwd, root, data),
      };
      servers[pluginServerId(plugin.id, name)] = applyPluginAuthBinding(raw, readPluginAuthBinding(store, plugin.id, name, server, plugin.receipt.revision));
    } catch (error) {
      diagnostics.push({ component: `mcp:${name}`, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return servers;
}
