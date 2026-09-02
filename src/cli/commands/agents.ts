/**
 * `agents` CLI: config is the source of truth for multi-agent paths.
 */

import { mkdir } from 'node:fs/promises';
import { Command } from 'commander';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { resolveConfigPath } from '../../config/paths.js';
import {
  normalizeAgentId,
  resolveAgentDir,
  resolveAgentProfileDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  validateAgentIdForNewAgent,
} from '../../agent/agent-scope.js';
import {
  applyAgentConfig,
  findAgentEntryIndex,
  getAgentDeleteBlocker,
  listAgentEntries,
  pruneAgentConfig,
  removeAgentDirsFromDisk,
} from '../../commands/agents.config.js';
import { seedAgentProfileMarkdownFiles } from '../../agent/context/workspace-seed.js';
import { colors } from '../utils/colors.js';

export function registerAgentsCli(program: Command): void {
  const agents = program
    .command('agents')
    .description('Manage agents (config + workspace)');

  agents
    .command('list')
    .description('List configured agents')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      const cfg = loadConfig();
      const rows = listAgentEntries(cfg).map((a) => ({
        id: normalizeAgentId(a.id),
        enabled: a.enabled !== false,
        workspace: a.workspace,
        model: a.models?.chat?.primary ?? cfg.agents.defaults.models.chat.primary,
      }));
      const def = resolveDefaultAgentId(cfg);
      if (opts.json) {
        console.log(JSON.stringify({ defaultAgentId: def, agents: rows }, null, 2));
        return;
      }
      console.log(colors.cyan(`Default agent id: ${def}`));
      if (rows.length === 0) {
        console.log('No entries in agents.list (using defaults only).');
        return;
      }
      for (const r of rows) {
        const mark = r.id === def ? ' (default routing)' : '';
        console.log(`- ${r.id}${mark}`);
      }
    });

  agents
    .command('add')
    .description('Add or update an agent in config and create workspace / state dirs')
    .argument('<name>', 'Agent display name / id seed')
    .requiredOption('--workspace <dir>', 'Workspace directory for this agent')
    .option('--model <id>', 'Model id (e.g. anthropic/claude-sonnet-4-5)')
    .option('--json', 'Output JSON summary')
    .action(
      async (
        name: string,
        opts: { workspace?: string; model?: string; json?: boolean },
      ) => {
        const cfg = loadConfig();
        const idRes = validateAgentIdForNewAgent(undefined, name);
        if (idRes.ok === false) {
          console.error(colors.red('Error:'), idRes.error);
          process.exit(1);
        }
        const agentId = idRes.agentId;

        const workspace = opts.workspace!.trim();
        const next = applyAgentConfig(cfg, {
          agentId,
          workspace,
          profile: { name: name.trim() },
          ...(opts.model?.trim() ? { model: opts.model.trim() } : {}),
        });

        const configPath = resolveConfigPath();
        await saveConfig(next, configPath);

        const wsPath = resolveAgentWorkspaceDir(next, agentId);
        const adPath = resolveAgentDir(next, agentId);
        const profilePath = resolveAgentProfileDir(next, agentId);
        await mkdir(wsPath, { recursive: true });
        await mkdir(adPath, { recursive: true });
        await mkdir(profilePath, { recursive: true });
        seedAgentProfileMarkdownFiles(profilePath, wsPath, { displayName: name.trim() });

        const payload = { agentId, workspace: wsPath, agentDir: adPath, model: opts.model };
        if (opts.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(colors.green('✓'), `Configured agent "${agentId}"`);
          console.log(`  Workspace:  ${wsPath}`);
          console.log(`  Agent dir:  ${adPath}`);
        }
      },
    );

  agents
    .command('delete')
    .description('Remove an agent from config (optional on-disk cleanup)')
    .argument('<id>', 'Agent id')
    .option('--purge', 'Also delete workspace and ~/.xopc/agents/<id> data', false)
    .option('--json', 'Output JSON summary')
    .action(async (id: string, opts: { purge?: boolean; json?: boolean }) => {
      const cfg = loadConfig();
      const blocker = getAgentDeleteBlocker(cfg, id);
      if (blocker) {
        console.error(colors.red('Error:'), blocker);
        process.exit(1);
      }
      const idx = findAgentEntryIndex(listAgentEntries(cfg), id);
      if (idx < 0) {
        console.error(colors.red('Error:'), `Agent "${id}" not found in agents.list`);
        process.exit(1);
      }
      const { config: pruned, removedBindings } = pruneAgentConfig(cfg, id);
      await saveConfig(pruned, resolveConfigPath());
      let purged = false;
      if (opts.purge) {
        await removeAgentDirsFromDisk(pruned, id);
        purged = true;
      }
      const payload = { deleted: id, removedBindings, purged };
      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(colors.green('✓'), `Removed agent "${id}" from config`);
        if (removedBindings > 0) {
          console.log(`  Stripped ${removedBindings} routing binding(s).`);
        }
        if (purged) {
          console.log('  On-disk workspace/state removed.');
        }
      }
    });
}
