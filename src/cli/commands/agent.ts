import { Command } from 'commander';
import { AgentService } from '../../agent/index.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { MessageBus, MessageBusShutdownError } from '../../infra/bus/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import { ExtensionLoader } from '../../extensions/index.js';
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
        'xopc agent -m "Hello"                       # Single message',
        'xopc agent -i                                # Interactive chat mode',
        'xopc agent -i --session telegram:dm:123456  # Continue existing session',
        'xopc agent --list                            # List available sessions',
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
        await listSessions();
        return;
      }

      const modelConfig = config.agents?.defaults?.model;
      const modelId = typeof modelConfig === 'string' ? modelConfig : modelConfig?.primary;
      const bus = new MessageBus();

      if (ctx.isVerbose) {
        log.info({ model: modelId, workspace, session: options.session }, 'Starting agent');
      }

      // Validate session key if provided
      let sessionKey = options.session || 'cli:direct';
      if (options.session) {
        const { getSessionManager } = await import('../utils/session.js');
        const manager = await getSessionManager();
        const session = await manager.getSessionMetadata(options.session);
        if (!session) {
          console.error(`❌ Session not found: ${options.session}`);
          console.log('Use --list to see available sessions.');
          process.exit(1);
        }
        console.log(`📂 Continuing session: ${options.session} (${session.messageCount} messages)\n`);
      }

      // Initialize extension loader (manifest-first activation: env, channels, model, extensions.*)
      let extensionLoader: ExtensionLoader | null = null;
      try {
        extensionLoader = new ExtensionLoader({
          workspaceDir: workspace,
          extensionsDir: join(workspace, '.extensions'),
        });
        extensionLoader.setConfig(config as Parameters<ExtensionLoader['setConfig']>[0]);
        extensionLoader.setRuntimeContext({ bus });
        await extensionLoader.loadByActivationPlan();
        const n = extensionLoader.getRegistry().extensions.size;
        if (n > 0) {
          log.info({ count: n }, 'Extensions loaded');
        }
      } catch (error) {
        const em = error instanceof Error ? error.message : String(error);
        log.warn({ err: error, errorMessage: em }, `CLI agent: failed to load extensions: ${em}`);
      }

      const { createCliReadlineClarifyRequestFn } = await import('../../agent/tools/cli-clarify.js');

      const agent = new AgentService(bus, {
        workspace,
        model: modelId,
        config,
        extensionRegistry: extensionLoader?.getRegistry(),
        gatewayClarify: {
          requestClarification: createCliReadlineClarifyRequestFn(),
        },
      });

      // Start agent service in background
      agent.start().catch((err) => {
        const em = err instanceof Error ? err.message : String(err);
        log.error({ err, errorMessage: em }, `CLI agent service exited: ${em}`);
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
            const em = error instanceof Error ? error.message : String(error);
            log.error({ err: error, errorMessage: em }, `CLI outbound processor failed: ${em}`);
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
      'xopc agent -m "Hello"',
      'xopc agent -i',
    ],
  },
});
