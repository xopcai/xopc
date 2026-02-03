import { createCLI } from './core.js';
import { createOnboardCommand } from './commands/onboard.js';
import { createAgentCommand } from './commands/agent.js';
import { createGatewayCommand } from './commands/gateway.js';
import { createCronCommand } from './commands/cron.js';
import { createConfigureCommand } from './commands/configure.js';
import { createConfigCommand } from './commands/config.js';

const program = createCLI();

program.addCommand(createOnboardCommand());
program.addCommand(createAgentCommand());
program.addCommand(createGatewayCommand());
program.addCommand(createCronCommand());
program.addCommand(createConfigureCommand());
program.addCommand(createConfigCommand());

// Handle --version flag
program.parse(process.argv);

// Show help if no arguments
if (process.argv.length <= 2) {
  program.help();
}
