#!/usr/bin/env node
import { Command } from 'commander';
import { registry, createDefaultContext, type CLIContext } from './registry.js';
import pkg from '../../package.json' with { type: 'json' };
import { flushAndClose } from '../utils/logger.js'; // Import flushAndClose for graceful shutdown

// Import order determines display order in help
import './commands/setup.js';
import './commands/onboard.js';
import './commands/agent.js';
import './commands/gateway.js';
import './commands/session.js';
import './commands/cron.js';
import './commands/config.js';
import './commands/models.js';
import './commands/extension.js';
import './commands/auth.js';
import './commands/skills.js';
import './commands/logs.js';
import './commands/acp.js';


// Global parsed options - updated before each command
export let parsedOpts: { config?: string; workspace?: string; verbose?: boolean } = {};

export function getContextWithOpts(argv: string[] = process.argv): CLIContext {
  return createDefaultContext(argv, parsedOpts);
}

// Long-running commands that should not auto-exit
const LONG_RUNNING_COMMANDS = new Set(['gateway', 'agent']);

const program = new Command()
  .name('xopcbot')
  .description('Ultra-Lightweight Personal AI Assistant')
  .version(pkg.version)
  .option('--verbose', 'Enable verbose logging', false)
  .option('--config <path>', 'Config file path')
  .option('--workspace <path>', 'Workspace directory');

// Hook to capture parsed options before each command runs
program.hook('preAction', (thisCommand) => {
  parsedOpts = thisCommand.opts();
});

// Hook to ensure process exits after command completion
program.hook('postAction', async (thisCommand) => {
  // Get the actual subcommand being executed (not the root program name)
  const args = thisCommand.args;
  const subCommandName = args.length > 0 ? args[0] : thisCommand.name();
  // Skip long-running commands (gateway foreground, agent interactive)
  if (LONG_RUNNING_COMMANDS.has(subCommandName)) {
    return;
  }
  // For all other commands, flush logs and exit
  await flushAndClose();
  process.exit(0);
});

// Create initial context (will use env vars and defaults)
const ctx = getContextWithOpts(process.argv);
registry.install(program, ctx);

// Only parse if this is the main module being executed directly
// Skip parsing when imported as module (e.g., in tests)
const isTestEnv = !!process.env.VITEST || !!process.env.TEST || !!process.env.NODE_ENV?.includes('test');
const isMainModule = !isTestEnv && import.meta.url.startsWith('file:');

if (isMainModule) {
  // Filter out standalone '--' separator (passed by pnpm run -- <cmd>)
  // npm removes it automatically, pnpm passes it through
  const argv = process.argv.filter((arg, index) => {
    if (arg !== '--') return true;
    // Only filter '--' if it's the separator between script and command
    // (i.e., comes after the script name and before actual args)
    return index < 2; // Keep '--' if it's a script argument (index 0 or 1)
  });
  program.parse(argv);
}
