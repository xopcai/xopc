import { pluginAuthorizations } from '../../extensions/agent-plugins/setup-contract.js';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { AgentPluginStore } from '../../extensions/agent-plugins/store.js';
import { withAgentPluginSource, isAgentPluginArchive } from '../../extensions/agent-plugins/sources.js';
import { pluginServerId } from '../../extensions/agent-plugins/validation.js';
import { PLUGIN_MANIFEST_PATHS } from '../../extensions/agent-plugins/formats.js';
import { isGitPluginSource } from '../../extensions/agent-plugins/source-catalog.js';
import { loadConfig } from '../../config/loader.js';
import { getContextWithOpts } from '../context.js';
import { PluginSetupService } from '../../extensions/agent-plugins/setup.js';
import { readFile } from 'node:fs/promises';
import { getWorkspacePath } from '../../config/workspace-path-helpers.js';
import { removePluginCredentials } from '../../extensions/agent-plugins/credentials.js';

export function isAgentPluginSource(source: string): boolean {
  if (source.startsWith('https://') || isGitPluginSource(source) || source.includes('#plugin=')) return true;
  const path = resolve(source);
  if (existsSync(join(path, 'package.json'))) {
    const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    if (pkg?.xopc?.extension) return false;
  }
  return existsSync(path) && (statSync(path).isFile() && /\.zip$/i.test(path) && statSync(path).size <= 50 * 1024 * 1024 && isAgentPluginArchive(readFileSync(path))
    || [...PLUGIN_MANIFEST_PATHS, '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json'].some(file => existsSync(join(path, file))) && !existsSync(join(path, 'xopc.extension.json')));
}
export async function installAgentPluginFromCli(source: string, options: { yes?: boolean; force?: boolean; expectedId?: string }) {
  const store = new AgentPluginStore();
  const cfg = loadConfig(getContextWithOpts().configPath);
  const plan = await withAgentPluginSource(source, cfg, (local, _p, _commit, importManifest) => store.inspect(local, source, importManifest));
  console.log(JSON.stringify({ format: 'agent-plugin', name: plan.manifest.name, version: plan.manifest.version,
    capabilities: plan.capabilities, addedCapabilities: plan.addedCapabilities, diagnostics: plan.diagnostics }, null, 2));
  if (!options.yes && (!plan.installed || plan.addedCapabilities.length)) {
    if (!process.stdin.isTTY) throw new Error('Capability review requires --yes in non-interactive mode');
    if (!await confirm({ message: 'Install this Agent Plugin with these capabilities?', default: false })) return;
  }
  const plugin = await withAgentPluginSource(source, cfg, (local, provenance, resolvedCommit, importManifest) => store.install(local, { reviewHash: plan.reviewHash, replace: options.force, stage: options.force, expectedId: options.expectedId, sourceLabel: source, provenance, resolvedCommit, importManifest }));
  if (plugin.readiness !== 'blocked') new PluginSetupService(store).create(plugin.id, 'gateway-owner');
  console.log(`Installed plugin:${plugin.id} (${plugin.receipt.enabled ? 'enabled' : 'disabled'}).`);
  if (plugin.readiness !== 'blocked') console.log(`Continue with: xopc extensions setup plugin:${plugin.id} --prepare`);
  return plugin;
}
export function addAgentPluginLifecycleCommands(command: Command): void {
  command.command('setup').argument('<id>', 'plugin:<id>')
    .option('--prepare', 'Prepare resources and check tools')
    .option('--authorize <server>', 'Authorize a plugin account or show native MCP sign-in instructions')
    .option('--method <id>', 'Choose one of the account authorization methods')
    .option('--skip-auth', 'Finish installation and authorize later in plugin details')
    .option('--complete', 'Finish setup and enable globally for all agents')
    .option('--workspace <paths...>', 'Restrict the plugin to these workspace paths')
    .option('--config-file <path>', 'Read typed user configuration from a JSON file')
    .option('--allow-partial', 'Enable available components after reviewing compatibility limits')
    .option('--cancel', 'Cancel preparation')
    .action(async (raw: string, options: { prepare?: boolean; authorize?: string; method?: string; complete?: boolean; skipAuth?: boolean; workspace?: string[]; configFile?: string; allowPartial?: boolean; cancel?: boolean }) => {
      const store = new AgentPluginStore(), setup = new PluginSetupService(store), id = raw.replace(/^plugin:/, '');
      const cfg = loadConfig(getContextWithOpts().configPath), workspace = getWorkspacePath(cfg) || process.cwd(), owner = 'gateway-owner';
      let job = setup.create(id, owner);
      const declaration = pluginAuthorizations((store.pending(id) ?? store.get(id))!.manifest).find(value => value.id === options.authorize);
      const method = declaration?.methods.find(value => value.id === (options.method ?? declaration.methods[0]?.id));
      if (options.configFile) job = await setup.act(id, owner, { action: 'configure', expectedRevision: job.revision, values: JSON.parse(await readFile(options.configFile, 'utf8')), ...(method?.type === 'form' ? { authorization: declaration!.id, method: method.id } : {}) }, cfg, workspace);
      if (options.prepare || declaration) job = await setup.act(id, owner, { action: 'prepare', expectedRevision: job.revision }, cfg, workspace);
      if (options.authorize) {
        if (declaration) {
          if (!method) throw new Error('Unknown authorization method');
          if (method.type !== 'form') {
            job = await setup.act(id, owner, { action: 'authorize', expectedRevision: job.revision, server: declaration.id, method: method.id }, cfg, workspace);
            let lastUrl = '';
            for (;;) {
              const attempt = await setup.authorization(id, owner, declaration.id, cfg);
              if (!attempt) throw new Error('Sign-in is unavailable. Retry authorization.');
              const url = 'challenge' in attempt ? attempt.challenge?.url : 'authorizationUrl' in attempt ? attempt.authorizationUrl : undefined;
              if (url && url !== lastUrl) { console.log(`Complete sign-in: ${url}`); lastUrl = url; }
              if (attempt.state === 'connected') break;
              if (['cancelled', 'error'].includes(attempt.state)) throw new Error('Sign-in did not complete. Retry authorization.');
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            job = await setup.act(id, owner, { action: 'prepare', expectedRevision: job.revision }, cfg, workspace);
          } else if (!options.configFile) throw new Error('Provide credential fields with --config-file');
        } else {
          if (!job.connections.some(c => c.name === options.authorize)) throw new Error('Unknown plugin MCP server');
          console.log(`Sign in with: xopc mcp login ${pluginServerId(id, options.authorize)}`);
        }
      }
      if (options.complete) job = await setup.act(id, owner, { action: 'complete', expectedRevision: job.revision, workspacePaths: options.workspace, allowPartial: options.allowPartial === true }, cfg, workspace);
      if (options.skipAuth) job = await setup.act(id, owner, { action: 'defer', expectedRevision: job.revision }, cfg, workspace);
      if (options.cancel) job = await setup.act(id, owner, { action: 'cancel', expectedRevision: job.revision }, cfg, workspace);
      console.log(JSON.stringify(job, null, 2));
    });
  command.command('rollback').argument('<id>', 'plugin:<name>').action((raw: string) => {
    console.log(JSON.stringify(new AgentPluginStore().rollback(raw.replace(/^plugin:/, '')), null, 2));
  });
  for (const action of ['enable', 'disable'] as const) command.command(action).argument('<id>', 'plugin:<name>').action((raw: string) => {
    const store = new AgentPluginStore(), id = raw.replace(/^plugin:/, '');
    const job = new PluginSetupService(store).get(id, 'gateway-owner');
    if (action === 'enable' && job && job.state !== 'completed') throw new Error('Finish plugin setup before enabling');
    const plugin = store.setEnabled(id, action === 'enable');
    console.log(`${plugin.id}: ${action}d`);
  });
  command.command('remove').argument('<id>', 'plugin:<name>').option('--remove-data', 'Also remove persistent plugin data').option('--remove-credentials', 'Also delete local credentials').action(async (raw: string, options: { removeData?: boolean; removeCredentials?: boolean }) => {
    const store = new AgentPluginStore(); const id = raw.replace(/^plugin:/, '');
    if (options.removeCredentials) await removePluginCredentials(store, id);
    store.remove(id, options.removeData);
    console.log(`Removed ${raw}; credentials ${options.removeCredentials ? 'deleted' : 'retained'}${options.removeData ? ', plugin data deleted' : ', plugin data retained'}.`);
  });
}
