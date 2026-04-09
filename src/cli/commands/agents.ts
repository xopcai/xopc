/**
 * OpenClaw-style `agents` CLI: config is the source of truth for multi-agent paths.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { resolveConfigPath } from '../../config/paths.js';
import {
  normalizeAgentId,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  DEFAULT_AGENT_ID,
} from '../../agents/agent-scope.js';
import {
  applyAgentConfig,
  findAgentEntryIndex,
  listAgentEntries,
  pruneAgentConfig,
  removeAgentDirsFromDisk,
} from '../../commands/agents.config.js';
import { seedWorkspaceBootstrapFiles } from '../../agent/context/workspace-seed.js';
import { colors } from '../utils/colors.js';

function requireNonMain(id: string): void {
  if (normalizeAgentId(id) === DEFAULT_AGENT_ID) {
    throw new Error(`Agent id "${DEFAULT_AGENT_ID}" is reserved for the primary agent.`);
  }
}

export function registerAgentsCli(program: Command): void {
  const agents = program
    .command('agents')
    .description('Manage agents (config + workspace; OpenClaw-style)');

  agents
    .command('list')
    .description('List configured agents')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      const cfg = loadConfig();
      const rows = listAgentEntries(cfg).map((a) => ({
        id: normalizeAgentId(a.id),
        name: a.name,
        default: a.default === true,
        enabled: a.enabled !== false,
        workspace: a.workspace,
        agentDir: a.agentDir,
        model: a.model,
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
        console.log(`- ${r.id}${mark}${r.name ? ` — ${r.name}` : ''}`);
      }
    });

  agents
    .command('add')
    .description('Add or update an agent in config and create workspace / state dirs')
    .argument('<name>', 'Agent display name / id seed')
    .requiredOption('--workspace <dir>', 'Workspace directory for this agent')
    .option('--model <id>', 'Model id (e.g. anthropic/claude-sonnet-4-5)')
    .option('--agent-dir <dir>', 'Override internal agent state directory')
    .option('--json', 'Output JSON summary')
    .action(
      async (
        name: string,
        opts: { workspace?: string; model?: string; agentDir?: string; json?: boolean },
      ) => {
        const cfg = loadConfig();
        const agentId = normalizeAgentId(name);
        requireNonMain(agentId);

        const workspace = opts.workspace!.trim();
        const next = applyAgentConfig(cfg, {
          agentId,
          name,
          workspace,
          ...(opts.model?.trim() ? { model: opts.model.trim() } : {}),
          ...(opts.agentDir?.trim() ? { agentDir: opts.agentDir.trim() } : {}),
        });

        const configPath = resolveConfigPath();
        await saveConfig(next, configPath);

        const wsPath = resolveAgentWorkspaceDir(next, agentId);
        const adPath = resolveAgentDir(next, agentId);
        await mkdir(wsPath, { recursive: true });
        await mkdir(adPath, { recursive: true });
        await mkdir(join(adPath, 'credentials'), { recursive: true });
        seedWorkspaceBootstrapFiles(wsPath);

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
    .option('--purge', 'Also delete workspace and ~/.xopcbot/agents/<id> data', false)
    .option('--json', 'Output JSON summary')
    .action(async (id: string, opts: { purge?: boolean; json?: boolean }) => {
      const cfg = loadConfig();
      requireNonMain(id);
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
