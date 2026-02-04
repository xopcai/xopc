import { Command } from 'commander';
import { AgentLoop } from '../../agent/index.js';
import { createProvider } from '../../providers/index.js';
import { loadConfig } from '../../config/index.js';
import { MessageBus } from '../../bus/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('AgentCommand');

export function createAgentCommand(): Command {
  const cmd = new Command('agent')
    .description('Chat with the agent')
    .option('-m, --message <text>', 'Message to send')
    .option('-i, --interactive', 'Interactive chat mode')
    .action(async (options) => {
      const config = loadConfig();
      const provider = createProvider(config);
      const bus = new MessageBus();
      
      const workspace = config.agents.defaults.workspace;
      const model = config.agents.defaults.model;
      const maxIterations = config.agents.defaults.max_tool_iterations;
      const braveApiKey = config.tools.web?.search?.api_key;

      const agent = new AgentLoop(
        bus,
        provider,
        workspace,
        model,
        maxIterations,
        braveApiKey
      );

      if (options.message) {
        // Single message mode
        const response = await agent.processDirect(options.message);
        console.log('\n🤖:', response);
      } else if (options.interactive) {
        // Interactive mode
        console.log('🧠 Interactive chat mode (Ctrl+C to exit)\n');
        
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        rl.on('line', async (input) => {
          const response = await agent.processDirect(input);
          console.log('\n🤖:', response);
          rl.prompt();
        });

        rl.on('close', () => {
          console.log('\n👋 Goodbye!');
          process.exit(0);
        });

        rl.setPrompt('You: ');
        rl.prompt();
      } else {
        // Show help
        cmd.help();
      }
    });

  return cmd;
}
