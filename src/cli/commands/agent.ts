import { Command } from 'commander';
import { AgentService } from '../../agent/index.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { MessageBus, MessageBusShutdownError } from '../../infra/bus/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import { ExtensionLoader, normalizeExtensionConfig } from '../../extensions/index.js';
import { join } from 'path';
import { listSessions } from './agent/sessions.js';
import { startInteractiveChat } from './agent/interactive.js';

const log = createLogger('AgentCommand');

interface AgentCommandOptions {
  message?: string;
  interactive?: boolean;
  session?: string;
  list?: boolean;
}

function createAgentCommand(_ctx: CLIContext): Command {
  const cmd = new Command('agent')
    .description('Chat with the AI agent')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot agent -m "Hello"                       # Single message',
        'xopcbot agent -i                                # Interactive chat mode',
        'xopcbot agent -i --session telegram:dm:123456  # Continue existing session',
        'xopcbot agent --list                            # List available sessions',
      ])
    )
    .option('-m, --message <text>', 'Single message to send')
    .option('-i, --interactive', 'Interactive chat mode')
    .option('-s, --session <key>', 'Continue an existing session (use --list to see available sessions)')
    .option('-l, --list', 'List available sessions and exit')
    .action(async (options: AgentCommandOptions) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const workspace = getWorkspacePath(config) || ctx.workspacePath;

      // Handle --list option
      if (options.list) {
        await listSessions(workspace);
        return;
      }

      const modelConfig = config.agents?.defaults?.model;
      const modelId = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary;
      const bus = new MessageBus();

      const braveApiKey = config.tools?.web?.search?.apiKey;

      if (ctx.isVerbose) {
        log.info({ model: modelId, workspace, session: options.session }, 'Starting agent');
      }

      // Validate session key if provided
      let sessionKey = options.session || 'cli:direct';
      if (options.session) {
        const { getSessionManager } = await import('../utils/session.js');
        const manager = await getSessionManager(workspace);
        const session = await manager.getSessionMetadata(options.session);
        if (!session) {
          console.error(`❌ Session not found: ${options.session}`);
          console.log('Use --list to see available sessions.');
          process.exit(1);
        }
        console.log(`📂 Continuing session: ${options.session} (${session.messageCount} messages)\n`);
      }

      // Initialize extension loader
      let extensionLoader: ExtensionLoader | null = null;
      try {
        const extensionsConfig = (config as any).extensions;
        if (extensionsConfig) {
          const resolvedConfigs = normalizeExtensionConfig(extensionsConfig);
          const enabledExtensions = resolvedConfigs.filter(c => c.enabled);
          
          if (enabledExtensions.length > 0) {
            extensionLoader = new ExtensionLoader({
              workspaceDir: workspace,
              extensionsDir: join(workspace, '.extensions'),
            });
            extensionLoader.setConfig(config as Parameters<ExtensionLoader['setConfig']>[0]);
            extensionLoader.setRuntimeContext({ bus });
            await extensionLoader.loadExtensions(enabledExtensions);
            log.info({ count: enabledExtensions.length }, 'Extensions loaded');
          }
        }
      } catch (error) {
        log.warn({ err: error }, 'Failed to load extensions');
      }

      const agent = new AgentService(bus, {
        workspace,
        model: modelId,
        braveApiKey,
        config,
        extensionRegistry: extensionLoader?.getRegistry(),
      });

      // Start agent service in background
      agent.start().catch((err) => {
        log.error({ err }, 'Agent service error');
      });

      // Start outbound message processor for CLI mode
      let running = true;
      const _outboundProcessor = (async () => {
        while (running) {
          try {
            const msg = await bus.consumeOutbound();
            console.log(`\n📤 [${msg.channel}] ${msg.chat_id}: ${msg.content.slice(0, 100)}...`);
          } catch (error) {
            if (error instanceof MessageBusShutdownError) {
              break;
            }
            log.error({ err: error }, 'Error in outbound processor');
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      })();

      const shutdown = async () => {
        running = false;
        bus.shutdown();
        await agent.stop();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      if (options.message) {
        const response = await agent.processDirect(options.message, sessionKey);
        console.log('\n🤖:', response);
        await shutdown();
      } else if (options.interactive) {
        await startInteractiveChat(agent, {
          workspace,
          sessionKey,
          continuingSession: !!options.session,
        });
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
