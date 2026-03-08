import { Command } from 'commander';
import { AgentService } from '../../agent/index.js';
import { SessionManager } from '../../session/index.js';
import { loadConfig, getWorkspacePath } from '../../config/index.js';
import { MessageBus, MessageBusShutdownError } from '../../bus/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import { ExtensionLoader, normalizeExtensionConfig } from '../../extensions/index.js';
import { join } from 'path';

const log = createLogger('AgentCommand');

interface AgentCommandOptions {
  message?: string;
  interactive?: boolean;
  session?: string;
  list?: boolean;
}

async function listSessions(workspace: string): Promise<void> {
  const manager = new SessionManager({ workspace });
  await manager.initialize();
  
  const result = await manager.listSessions({ limit: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
  
  console.log('\n📋 Available Sessions:\n');
  if (result.items.length === 0) {
    console.log('No sessions found.');
    return;
  }
  
  console.log('Key'.padEnd(35) + 'Name'.padEnd(20) + 'Messages'.padEnd(10) + 'Updated');
  console.log('─'.repeat(85));
  
  for (const session of result.items) {
    const name = (session.name || '-').slice(0, 18).padEnd(20);
    const messages = String(session.messageCount).padEnd(10);
    const updated = new Date(session.updatedAt).toLocaleDateString();
    console.log(`${session.key.slice(0, 33).padEnd(35)}${name}${messages}${updated}`);
  }
  console.log();
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
        const manager = new SessionManager({ workspace });
        await manager.initialize();
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
      // Just logs outbound messages to console (no channels in CLI mode)
      let running = true;
      const _outboundProcessor = (async () => {
        while (running) {
          try {
            const msg = await bus.consumeOutbound();
            // In CLI mode, just log outbound messages
            console.log(`\n📤 [${msg.channel}] ${msg.chat_id}: ${msg.content.slice(0, 100)}...`);
          } catch (error) {
            // Ignore shutdown errors during exit
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
        bus.shutdown(); // Shutdown bus to cancel pending consumers
        await agent.stop();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      if (options.message) {
        const response = await agent.processDirect(options.message, sessionKey);
        console.log('\n🤖:', response);
        await shutdown();
      } else if (options.interactive) {
        // Interactive mode
        if (options.session) {
          console.log('🧠 Interactive chat mode - Continuing session\n');
        } else {
          console.log('🧠 Interactive chat mode (Ctrl+C to exit)\n');
        }

        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: true,
        });

        rl.on('line', async (input) => {
          const trimmed = input.trim();
          
          // Handle special commands
          if (trimmed === ':sessions' || trimmed === ':list') {
            rl.pause();
            await listSessions(workspace);
            rl.resume();
            rl.prompt();
            return;
          }
          
          if (trimmed.startsWith(':session ')) {
            const newSessionKey = trimmed.slice(9).trim();
            const manager = new SessionManager({ workspace });
            await manager.initialize();
            const session = await manager.getSessionMetadata(newSessionKey);
            if (session) {
              sessionKey = newSessionKey;
              console.log(`🔄 Switched to session: ${sessionKey}\n`);
            } else {
              console.log(`❌ Session not found: ${newSessionKey}\n`);
            }
            rl.prompt();
            return;
          }

          if (trimmed === ':help') {
            console.log(`
📖 Available commands:
  :sessions, :list    - List available sessions
  :session <key>     - Switch to another session
  :quit, :exit       - Exit interactive mode
  :help              - Show this help
`);
            rl.prompt();
            return;
          }

          if (trimmed === ':quit' || trimmed === ':exit') {
            rl.close();
            return;
          }

          const response = await agent.processDirect(input, sessionKey);
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
