import { Command } from 'commander';
import { GatewayServer } from '../../gateway/index.js';
import { loadConfig } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';

const log = createLogger('AgentCommand');

function createAgentCommand(_ctx: CLIContext): Command {
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
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const modelId = config.agents?.defaults?.model;

      const workspace = config.agents?.defaults?.workspace || ctx.workspacePath;

      if (ctx.isVerbose) {
        log.info({ model: modelId, workspace }, 'Starting agent');
      }

      // Use GatewayServer to ensure full message routing (including outbound)
      const server = new GatewayServer({
        host: '127.0.0.1',  // localhost only for CLI mode
        port: 0,            // random port, not used in CLI mode
        configPath: ctx.configPath,
        enableHotReload: false,
      });

      await server.start();
      const agent = server.serviceInstance;

      const shutdown = async () => {
        await server.stop();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      if (options.message) {
        const response = await agent.processDirect(options.message);
        console.log('\n🤖:', response);
        await shutdown();
      } else if (options.interactive) {
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

        rl.on('close', async () => {
          console.log('\n👋 Goodbye!');
          await shutdown();
          process.exit(0);
        });

        rl.setPrompt('You: ');
        rl.prompt();
      } else {
        await shutdown();
        cmd.help();
      }
    });

  return cmd;
}

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
