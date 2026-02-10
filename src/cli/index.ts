#!/usr/bin/env node
import { Command } from 'commander';
import { registry, createDefaultContext } from './registry.js';

// Import order determines display order in help
import './commands/onboard.js';
import './commands/configure.js';
import './commands/agent.js';
import './commands/gateway.js';
import './commands/cron.js';
import './commands/config.js';
import './commands/models.js';

const program = new Command()
  .name('xopcbot')
  .description('Ultra-Lightweight Personal AI Assistant')
  .version('0.1.0')
  .option('--verbose', 'Enable verbose logging', false)
  .option('--config <path>', 'Config file path')
  .option('--workspace <path>', 'Workspace directory');

const ctx = createDefaultContext(process.argv);
registry.install(program, ctx);

if (process.argv.length <= 2) {
  program.help();
}

program.parse();
