#!/usr/bin/env node
import { Command } from 'commander';
import { registry, createDefaultContext } from './registry.js';

// Import all command modules (side effect: auto-register to registry)
// Note: import order determines display order in help
import './commands/onboard.js';      // setup category
import './commands/configure.js';    // setup category
import './commands/agent.js';        // runtime category
import './commands/gateway.js';      // runtime category
import './commands/cron.js';         // utility category
import './commands/config.js';       // utility category
import './commands/models.js';       // utility category

// Create CLI main program
const program = new Command()
  .name('xopcbot')
  .description('Ultra-Lightweight Personal AI Assistant')
  .version('0.1.0')
  .option('--verbose', 'Enable verbose logging', false)
  .option('--config <path>', 'Config file path')
  .option('--workspace <path>', 'Workspace directory');

// Create context and install commands
const ctx = createDefaultContext(process.argv);
registry.install(program, ctx);

// Show help if no arguments
if (process.argv.length <= 2) {
  program.help();
}

// Parse command line
program.parse();
