import { Command } from 'commander';
import crypto from 'crypto';
import { GatewayServer } from '../../gateway/index.js';
import { loadConfig, saveConfig, DEFAULT_PATHS } from '../../config/index.js';
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
        'xopcbot gateway token             # Show current token',
        'xopcbot gateway token --generate  # Generate new token',
      ])
    )
    .option('--host <address>', 'Host to bind to', '0.0.0.0')
    .option('--port <number>', 'Port to listen on', '18790')
    .option('--token <token>', 'Authentication token')
    .option('--no-hot-reload', 'Disable config hot reload')
    .addCommand(createTokenCommand())
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

/**
 * Create the token subcommand for managing gateway authentication token.
 */
function createTokenCommand(): Command {
  return new Command('token')
    .description('Manage gateway authentication token')
    .option('--generate', 'Generate a new token and save to config')
    .option('--mode <mode>', 'Auth mode: token or none', 'token')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const configPath = ctx.configPath || DEFAULT_PATHS.config;
      
      try {
        // Load current config
        const config = loadConfig(configPath);
        
        if (options.generate) {
          // Generate new token
          const newToken = crypto.randomBytes(24).toString('hex');
          
          // Update config
          config.gateway = config.gateway || {};
          config.gateway.auth = {
            mode: 'token',
            token: newToken,
          };
          
          // Save config
          await saveConfig(config, configPath);
          
          console.log('✅ Generated new gateway token:');
          console.log('');
          console.log(`   ${newToken}`);
          console.log('');
          console.log('📝 Saved to config file. Use this token in the X-Api-Key header or as:');
          console.log(`   xopcbot gateway --token ${newToken}`);
          console.log('');
          console.log('Or set environment variable:');
          console.log(`   export XOPCBOT_GATEWAY_TOKEN=${newToken}`);
        } else {
          // Show current token
          const currentToken = config.gateway?.auth?.token;
          const mode = config.gateway?.auth?.mode || 'token';
          
          if (mode === 'none') {
            console.log('⚠️  Gateway authentication is disabled (mode: none)');
            console.log('');
            console.log('To enable authentication, run:');
            console.log('   xopcbot gateway token --generate');
          } else if (currentToken) {
            const tokenPreview = `${currentToken.slice(0, 8)}...${currentToken.slice(-8)}`;
            console.log('🔑 Current gateway token:');
            console.log('');
            console.log(`   ${currentToken}`);
            console.log('');
            console.log(`Preview: ${tokenPreview}`);
            console.log('');
            console.log('Usage:');
            console.log(`   xopcbot gateway --token ${currentToken}`);
            console.log('');
            console.log('Or set environment variable:');
            console.log(`   export XOPCBOT_GATEWAY_TOKEN=${currentToken}`);
          } else {
            console.log('⚠️  No token configured. A token will be auto-generated on startup.');
            console.log('');
            console.log('To set a persistent token, run:');
            console.log('   xopcbot gateway token --generate');
          }
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to manage token');
        process.exit(1);
      }
    });
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
      'xopcbot gateway token',
      'xopcbot gateway token --generate',
    ],
  },
});
