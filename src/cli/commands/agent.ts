import { Command } from 'commander';
import { AgentService } from '../../agent/index.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { MessageBus } from '../../bus/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import { PluginLoader, normalizePluginConfig } from '../../plugins/index.js';
import { join } from 'path';

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
      const modelConfig = config.agents?.defaults?.model;
      const modelId = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary;
      const bus = new MessageBus();

      const workspace = getWorkspacePath(config) || ctx.workspacePath;
      const braveApiKey = config.tools?.web?.search?.apiKey;

      if (ctx.isVerbose) {
        log.info({ model: modelId, workspace }, 'Starting agent');
      }

      // Initialize plugin loader
      let pluginLoader: PluginLoader | null = null;
      try {
        const pluginsConfig = (config as any).plugins;
        if (pluginsConfig) {
          const resolvedConfigs = normalizePluginConfig(pluginsConfig);
          const enabledPlugins = resolvedConfigs.filter(c => c.enabled);
          
          if (enabledPlugins.length > 0) {
            pluginLoader = new PluginLoader({
              workspaceDir: workspace,
              pluginsDir: join(workspace, '.plugins'),
            });
            await pluginLoader.loadPlugins(enabledPlugins);
            log.info({ count: enabledPlugins.length }, 'Plugins loaded');
          }
        }
      } catch (error) {
        log.warn({ err: error }, 'Failed to load plugins');
      }

      const agent = new AgentService(bus, {
        workspace,
        model: modelId,
        braveApiKey,
        config,
        pluginRegistry: pluginLoader?.getRegistry(),
      });

      // Start agent service in background
      agent.start().catch((err) => {
        log.error({ err }, 'Agent service error');
      });

      // Start outbound message processor for CLI mode
      // Just logs outbound messages to console (no channels in CLI mode)
      let running = true;
      const _outboundProcessor = (async () => {
        while (running) {
          try {
            const msg = await bus.consumeOutbound();
            // In CLI mode, just log outbound messages
            console.log(`\n📤 [${msg.channel}] ${msg.chat_id}: ${msg.content.slice(0, 100)}...`);
          } catch (error) {
            log.error({ err: error }, 'Error in outbound processor');
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      })();

      const shutdown = async () => {
        running = false;
        await agent.stop();
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
