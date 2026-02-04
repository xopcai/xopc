#!/usr/bin/env node
import { createCLI } from './cli/core.js';
import { createOnboardCommand } from './cli/commands/onboard.js';
import { createAgentCommand } from './cli/commands/agent.js';
import { createModelsCommand } from './cli/commands/models.js';

const program = createCLI();

program.addCommand(createOnboardCommand());
program.addCommand(createAgentCommand());
program.addCommand(createModelsCommand());

// Handle --version flag
program.parse(process.argv);

// Show help if no arguments
if (process.argv.length <= 2) {
  program.help();
}
