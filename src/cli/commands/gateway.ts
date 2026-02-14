import { Command } from 'commander';
import { GatewayServer } from '../../gateway/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';

const log = createLogger('GatewayCommand');

function createGatewayCommand(_ctx: CLIContext): Command {
  const cmd = new Command('gateway')
    .description('Start the xopcbot gateway server')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot gateway                   # Start with default port',
        'xopcbot gateway --port 8080       # Custom port',
        'xopcbot gateway --host 127.0.0.1  # Bind to localhost only',
        'xopcbot gateway --token secret    # Enable authentication',
        'xopcbot gateway --no-hot-reload   # Disable config hot reload',
      ])
    )
    .option('--host <address>', 'Host to bind to', '0.0.0.0')
    .option('--port <number>', 'Port to listen on', '18790')
    .option('--token <token>', 'Authentication token')
    .option('--no-hot-reload', 'Disable config hot reload')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      
      const server = new GatewayServer({
        host: options.host,
        port: parseInt(options.port, 10),
        token: options.token,
        verbose: ctx.isVerbose,
        configPath: ctx.configPath,
        enableHotReload: options.hotReload,
      });

      let shuttingDown = false;
      
      const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        
        console.log(`\n🛑 Received ${signal}, shutting down...`);
        
        // Force exit after 5 seconds if graceful shutdown fails
        const forceExit = setTimeout(() => {
          console.log('⚠️  Force exiting...');
          process.exit(1);
        }, 5000);
        
        try {
          await server.stop();
          clearTimeout(forceExit);
          console.log('✅ Gateway stopped');
          process.exit(0);
        } catch (err) {
          clearTimeout(forceExit);
          console.error('❌ Error during shutdown:', err);
          process.exit(1);
        }
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));

      // Handle uncaught errors
      process.on('uncaughtException', (err) => {
        log.error({ err }, 'Uncaught exception');
        shutdown('uncaughtException');
      });

      process.on('unhandledRejection', (reason) => {
        log.error({ reason }, 'Unhandled rejection');
      });

      if (ctx.isVerbose) {
        log.info({ host: options.host, port: options.port }, 'Starting gateway');
      }

      try {
        await server.start();
      } catch (error) {
        log.error({ err: error }, 'Failed to start gateway');
        process.exit(1);
      }
    });

  return cmd;
}

register({
  id: 'gateway',
  name: 'gateway',
  description: 'Start the xopcbot gateway server',
  factory: createGatewayCommand,
  metadata: {
    category: 'runtime',
    examples: [
      'xopcbot gateway',
      'xopcbot gateway --port 8080',
      'xopcbot gateway --token my-secret-token',
    ],
  },
});
