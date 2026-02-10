import { Command } from 'commander';
import { AgentService } from '../../agent/index.js';
import { loadConfig } from '../../config/index.js';
import { MessageBus } from '../../bus/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

const log = createLogger('AgentCommand');

function createAgentCommand(ctx: CLIContext): Command {
  const cmd = new Command('agent')
    .description('Chat with the AI agent')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot agent -m "Hello"          # Single message',
        'xopcbot agent -i                  # Interactive mode',
        'xopcbot agent --message "Hello"   # Long form',
      ])
    )
    .option('-m, --message <text>', 'Single message to send')
    .option('-i, --interactive', 'Interactive chat mode')
    .action(async (options) => {
      const config = loadConfig();
      const modelId = config.agents?.defaults?.model;
      const bus = new MessageBus();

      const workspace = config.agents?.defaults?.workspace || process.cwd();
      const braveApiKey = config.tools?.web?.search?.apiKey;

      if (ctx.isVerbose) {
        log.info({ model: modelId, workspace }, 'Starting agent');
      }

      const agent = new AgentService(bus, {
        workspace,
        model: modelId,
        braveApiKey,
        config,  // Pass full config for custom model registration
      });

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

// Self-register to command registry
register({
  id: 'agent',
  name: 'agent',
  description: 'Chat with the AI agent',
  factory: createAgentCommand,
  metadata: {
    category: 'runtime',
    examples: [
      'xopcbot agent -m "Hello"',
      'xopcbot agent -i',
    ],
  },
});
