import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { AgentPluginStore } from '../../extensions/agent-plugins/store.js';
import { materializePluginServers } from '../../extensions/agent-plugins/mcp-adapter.js';
import { pluginServerId } from '../../extensions/agent-plugins/validation.js';
import { getMcpOAuthManager } from '../../agent/mcp/oauth/mcp-oauth-manager.js';
import { withAgentPluginSource, isAgentPluginArchive } from '../../extensions/agent-plugins/sources.js';
import { loadConfig } from '../../config/loader.js';
import { getContextWithOpts } from '../context.js';
import { savePluginAuthBinding } from '../../extensions/agent-plugins/auth.js';
import { removePluginCredentials } from '../../extensions/agent-plugins/credentials.js';

export function isAgentPluginSource(source: string): boolean {
  if (source.startsWith('https://')) return true;
  const path = resolve(source);
  if (existsSync(join(path, 'package.json'))) {
    const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    if (pkg?.xopc?.extension) return false;
  }
  return existsSync(path) && (statSync(path).isFile() && /\.zip$/i.test(path) && statSync(path).size <= 50 * 1024 * 1024 && isAgentPluginArchive(readFileSync(path))
    || existsSync(join(path, 'plugin.json')) && !existsSync(join(path, 'xopc.extension.json')));
}
export async function installAgentPluginFromCli(source: string, options: { yes?: boolean; force?: boolean; expectedId?: string }) {
  const store = new AgentPluginStore();
  const cfg = loadConfig(getContextWithOpts().configPath);
  const plan = await withAgentPluginSource(source, cfg, local => store.inspect(local));
  console.log(JSON.stringify({ format: 'agent-plugin', name: plan.manifest.name, version: plan.manifest.version,
    capabilities: plan.capabilities, addedCapabilities: plan.addedCapabilities, diagnostics: plan.diagnostics }, null, 2));
  if (!options.yes && (!plan.installed || plan.addedCapabilities.length)) {
    if (!process.stdin.isTTY) throw new Error('Capability review requires --yes in non-interactive mode');
    if (!await confirm({ message: 'Install this Agent Plugin with these capabilities?', default: false })) return;
  }
  const plugin = await withAgentPluginSource(source, cfg, local => store.install(local, { reviewHash: plan.reviewHash, replace: options.force, expectedId: options.expectedId, sourceLabel: source.startsWith('https://') || source.startsWith('store:') ? source : resolve(source) }));
  console.log(`Installed plugin:${plugin.id} (${plugin.receipt.enabled ? 'enabled' : 'disabled'}).`);
  return plugin;
}
export function addAgentPluginLifecycleCommands(command: Command): void {
  command.command('rollback').argument('<id>', 'plugin:<name>').action((raw: string) => {
    console.log(JSON.stringify(new AgentPluginStore().rollback(raw.replace(/^plugin:/, '')), null, 2));
  });
  for (const action of ['enable', 'disable'] as const) command.command(action).argument('<id>', 'plugin:<name>').action((raw: string) => {
    const plugin = new AgentPluginStore().setEnabled(raw.replace(/^plugin:/, ''), action === 'enable');
    console.log(`${plugin.id}: ${action}d`);
  });
  command.command('remove').argument('<id>', 'plugin:<name>').option('--remove-data', 'Also remove persistent plugin data').option('--remove-credentials', 'Also delete local credentials').action(async (raw: string, options: { removeData?: boolean; removeCredentials?: boolean }) => {
    const store = new AgentPluginStore(); const id = raw.replace(/^plugin:/, '');
    if (options.removeCredentials) await removePluginCredentials(store, id);
    store.remove(id, options.removeData);
    console.log(`Removed ${raw}; credentials ${options.removeCredentials ? 'deleted' : 'retained'}${options.removeData ? ', plugin data deleted' : ', plugin data retained'}.`);
  });
  command.command('connect').argument('<id>', 'plugin:<name>').requiredOption('--mcp <server>', 'MCP server name').action(async (raw: string, options: { mcp: string }) => {
    const store = new AgentPluginStore(); const id = raw.replace(/^plugin:/, ''); const plugin = store.get(id);
    if (!plugin || plugin.readiness === 'blocked') throw new Error('Plugin is unavailable');
    await savePluginAuthBinding(store, id, options.mcp, { mode: 'oauth' });
    const serverId = pluginServerId(id, options.mcp); const server = materializePluginServers(plugin, store)[serverId];
    if (!server) throw new Error('MCP server not found');
    const status = await getMcpOAuthManager(server).start({ serverId, rawServer: server });
    console.log(JSON.stringify(status, null, 2));
  });
}
