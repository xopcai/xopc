/**
 * `agents` CLI: SQLite is the source of truth for Agent definitions and defaults.
 */

import { Command } from 'commander';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { AgentCatalogService } from '../../agent-catalog/service.js';
import {
  normalizeAgentId,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  validateAgentIdForNewAgent,
} from '../../agent/agent-scope.js';
import { resolveEffectiveAgentConfigForAgent } from '../../config/agent-profile.js';
import { colors } from '../utils/colors.js';

export function registerAgentsCli(program: Command): void {
  const agents = program
    .command('agents')
    .description('Manage agents');

  agents
    .command('list')
    .description('List configured agents')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      const rows = new AgentCatalogRepository().snapshot().agents.map((a) => ({
        id: normalizeAgentId(a.id),
        enabled: a.enabled !== false,
        workspace: a.workspace,
        model: resolveEffectiveAgentConfigForAgent(a.id).config.models.chat.primary,
      }));
      const def = resolveDefaultAgentId();
      if (opts.json) {
        console.log(JSON.stringify({ defaultAgentId: def, agents: rows }, null, 2));
        return;
      }
      console.log(colors.cyan(`Default agent id: ${def}`));
      if (rows.length === 0) {
        console.log('No configured Agents.');
        return;
      }
      for (const r of rows) {
        const mark = r.id === def ? ' (default routing)' : '';
        console.log(`- ${r.id}${mark}`);
      }
    });

  agents
    .command('add')
    .description('Create an Agent and its workspace / state directories')
    .argument('<name>', 'Agent display name / id seed')
    .requiredOption('--workspace <dir>', 'Workspace directory for this agent')
    .option('--model <id>', 'Model id (e.g. anthropic/claude-sonnet-4-5)')
    .option('--json', 'Output JSON summary')
    .action(
      async (
        name: string,
        opts: { workspace?: string; model?: string; json?: boolean },
      ) => {
        const idRes = validateAgentIdForNewAgent(undefined, name);
        if (idRes.ok === false) {
          console.error(colors.red('Error:'), idRes.error);
          process.exit(1);
        }
        const agentId = idRes.agentId;

        const workspace = opts.workspace!.trim();
        await new AgentCatalogService().create({
          id: agentId,
          enabled: true,
          workspace,
          profile: { name: name.trim() },
          ...(opts.model?.trim()
            ? { models: { chat: { primary: opts.model.trim(), fallbacks: [] } } }
            : {}),
        });

        const wsPath = resolveAgentWorkspaceDir(agentId);
        const adPath = resolveAgentDir(agentId);

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
      let removedBindings: number;
      try {
        ({ removedBindings } = await new AgentCatalogService().delete(id, { purge: opts.purge }));
      } catch (error) {
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
      const purged = opts.purge === true;
      const payload = { deleted: id, removedBindings, purged };
      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(colors.green('✓'), `Removed Agent "${id}"`);
        if (removedBindings > 0) {
          console.log(`  Stripped ${removedBindings} routing binding(s).`);
        }
        if (purged) {
          console.log('  On-disk workspace/state removed.');
        }
      }
    });
}
