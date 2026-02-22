#!/usr/bin/env node
import { Command } from 'commander';
import { registry, createDefaultContext, type CLIContext } from './registry.js';
import pkg from '../../package.json' with { type: 'json' };

// Import order determines display order in help
import './commands/onboard.js';
import './commands/configure.js';
import './commands/agent.js';
import './commands/gateway.js';
import './commands/session.js';
import './commands/cron.js';
import './commands/config.js';
import './commands/models.js';
import './commands/plugin.js';
import './commands/auth.js';
import './commands/skills.js';


// Global parsed options - updated before each command
export let parsedOpts: { config?: string; workspace?: string; verbose?: boolean } = {};

export function getContextWithOpts(argv: string[] = process.argv): CLIContext {
  return createDefaultContext(argv, parsedOpts);
}

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

// Create initial context (will use env vars and defaults)
const ctx = getContextWithOpts(process.argv);
registry.install(program, ctx);

// Only parse if this is the main module
// Skip parsing only when there are non-flag arguments (commands)
const hasArgs = process.argv.length > 2;
const isFlag = process.argv[2]?.startsWith('-');
if (import.meta.url.startsWith('file:')) {
  // Always parse for flags (--version, --help) or no args
  // Only skip when there's a command argument
  if (!hasArgs || isFlag) {
    program.parse(process.argv);
  }
}
