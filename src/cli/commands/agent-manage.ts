import { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { createAgent, deleteAgent, getAgent, listAgents } from '../../agent/agent-registry.js';
import { colors } from '../utils/colors.js';
import Table from 'cli-table3';

const log = createLogger('AgentCommands');

// ============================================
// Agent List Command
// ============================================

export function createAgentListCommand(): Command {
  return new Command('agent:list')
    .description('List all agents')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const agents = await listAgents();

        if (options.json) {
          console.log(JSON.stringify(agents, null, 2));
          return;
        }

        if (agents.length === 0) {
          console.log('No agents found. Create one with: xopcbot agent:create <name>');
          return;
        }

        const table = new Table({
          head: ['ID', 'Name', 'Status', 'Model', 'Last Active'].map((h) => colors.cyan(h)),
          colWidths: [20, 20, 10, 30, 20],
        });

        for (const agent of agents) {
          const statusColor =
            agent.status === 'running'
              ? colors.green
              : agent.status === 'error'
              ? colors.red
              : colors.gray;

          table.push([
            agent.id === 'main' ? colors.yellow(agent.id) : agent.id,
            agent.name,
            statusColor(agent.status),
            agent.model || '-',
            agent.lastActiveAt
              ? new Date(agent.lastActiveAt).toLocaleString()
              : '-',
          ]);
        }

        console.log(table.toString());
        console.log(`\nTotal: ${agents.length} agents`);
      } catch (error) {
        log.error({ error }, 'Failed to list agents');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Agent PS Command (running agents)
// ============================================

export function createAgentPsCommand(): Command {
  return new Command('agent:ps')
    .description('Show running agents')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const allAgents = await listAgents();
        const runningAgents = allAgents.filter((a) => a.status === 'running');

        if (options.json) {
          console.log(JSON.stringify(runningAgents, null, 2));
          return;
        }

        if (runningAgents.length === 0) {
          console.log('No running agents.');
          return;
        }

        const table = new Table({
          head: ['ID', 'Name', 'PID', 'Model', 'Last Active'].map((h) => colors.cyan(h)),
          colWidths: [20, 20, 10, 30, 20],
        });

        for (const agent of runningAgents) {
          table.push([
            agent.id,
            agent.name,
            agent.pid?.toString() || '-',
            agent.model || '-',
            agent.lastActiveAt
              ? new Date(agent.lastActiveAt).toLocaleString()
              : '-',
          ]);
        }

        console.log(table.toString());
        console.log(`\nRunning: ${runningAgents.length} agents`);
      } catch (error) {
        log.error({ error }, 'Failed to list running agents');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Agent Create Command
// ============================================

export function createAgentCreateCommand(): Command {
  return new Command('agent:create')
    .description('Create a new agent')
    .argument('<id>', 'Agent ID (letters, numbers, hyphens, underscores)')
    .option('-n, --name <name>', 'Display name')
    .option('-d, --description <desc>', 'Description')
    .option('-m, --model <model>', 'Model to use (e.g., anthropic/claude-sonnet-4-5)')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('--copy-from <agentId>', 'Copy workspace from existing agent')
    .action(async (id, options) => {
      try {
        const agent = await createAgent(id, {
          name: options.name,
          description: options.description,
          model: options.model,
          tags: options.tags?.split(',').map((t: string) => t.trim()),
          copyFrom: options.copyFrom,
        });

        console.log(colors.green('✓'), `Created agent "${agent.name}" (${agent.id})`);
        console.log(`\n  Directory: ${agent.agentDir}`);
        console.log(`  Workspace: ${agent.workspaceDir}`);
        console.log(`  Sessions:  ${agent.sessionsDir}`);
        console.log(`\nTo use this agent:`);
        console.log(`  export XOPCBOT_AGENT_ID=${agent.id}`);
      } catch (error) {
        log.error({ error }, 'Failed to create agent');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Agent Delete Command
// ============================================

export function createAgentDeleteCommand(): Command {
  return new Command('agent:delete')
    .description('Delete an agent')
    .argument('<id>', 'Agent ID')
    .option('-f, --force', 'Force delete even if running')
    .action(async (id, options) => {
      try {
        const agent = await getAgent(id);
        if (!agent) {
          console.error(colors.red('Error:'), `Agent "${id}" not found`);
          process.exit(1);
        }

        await deleteAgent(id, { force: options.force });

        console.log(colors.green('✓'), `Deleted agent "${agent.name}" (${id})`);
      } catch (error) {
        log.error({ error }, 'Failed to delete agent');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Agent Info Command
// ============================================

export function createAgentInfoCommand(): Command {
  return new Command('agent:info')
    .description('Show agent details')
    .argument('<id>', 'Agent ID')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const agent = await getAgent(id);

        if (!agent) {
          console.error(colors.red('Error:'), `Agent "${id}" not found`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(agent, null, 2));
          return;
        }

        console.log(colors.cyan('Agent Information'));
        console.log('='.repeat(50));
        console.log(`ID:          ${agent.id}`);
        console.log(`Name:        ${agent.name}`);
        console.log(`Status:      ${agent.status}`);
        if (agent.pid) {
          console.log(`PID:         ${agent.pid}`);
        }
        console.log(`Model:       ${agent.model || '-'}`);
        console.log(`Description: ${agent.description || '-'}`);
        console.log(`Tags:        ${agent.tags?.join(', ') || '-'}`);
        console.log(`Last Active: ${agent.lastActiveAt ? new Date(agent.lastActiveAt).toLocaleString() : '-'}`);
        console.log();
        console.log(`Directory:   ${agent.agentDir}`);
        console.log(`Workspace:   ${agent.workspaceDir}`);
        console.log(`Sessions:    ${agent.sessionsDir}`);
      } catch (error) {
        log.error({ error }, 'Failed to get agent info');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Agent Switch Command
// ============================================

export function createAgentSwitchCommand(): Command {
  return new Command('agent:switch')
    .description('Get shell command to switch to an agent')
    .argument('<id>', 'Agent ID')
    .action(async (id) => {
      try {
        const agent = await getAgent(id);

        if (!agent) {
          console.error(colors.red('Error:'), `Agent "${id}" not found`);
          process.exit(1);
        }

        console.log(colors.cyan('Run this command to switch to this agent:'));
        console.log();
        console.log(`  export XOPCBOT_AGENT_ID=${id}`);
        console.log();
        console.log('Or add to your shell profile:');
        console.log(`  echo 'export XOPCBOT_AGENT_ID=${id}' >> ~/.bashrc`);
      } catch (error) {
        log.error({ error }, 'Failed to switch agent');
        console.error(colors.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

// ============================================
// Register All Commands
// ============================================

export function registerAgentCommands(program: Command): void {
  program.addCommand(createAgentListCommand());
  program.addCommand(createAgentPsCommand());
  program.addCommand(createAgentCreateCommand());
  program.addCommand(createAgentDeleteCommand());
  program.addCommand(createAgentInfoCommand());
  program.addCommand(createAgentSwitchCommand());
}
