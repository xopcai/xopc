#!/usr/bin/env node
import { Command } from 'commander';
import { registry, createDefaultContext, type CLIContext } from './registry.js';

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


// Global parsed options - updated before each command
export let parsedOpts: { config?: string; workspace?: string; verbose?: boolean } = {};

export function getContextWithOpts(argv: string[] = process.argv): CLIContext {
  return createDefaultContext(argv, parsedOpts);
}

const program = new Command()
  .name('xopcbot')
  .description('Ultra-Lightweight Personal AI Assistant')
  .version('0.1.0')
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

// Only parse if this is the main module and has command arguments
const hasCommand = process.argv.length > 2 && !process.argv[2]?.startsWith('-');
if (import.meta.url.startsWith('file:') && hasCommand) {
  program.parse(process.argv);
}
