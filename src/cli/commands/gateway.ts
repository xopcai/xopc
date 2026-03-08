import { Command } from 'commander';
import { spawn } from 'child_process';
import { GatewayServer } from '../../gateway/index.js';
import { loadConfig, DEFAULT_PATHS } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import { runGatewayLoop } from '../../gateway/run-loop.js';
import { forceFreePortAndWait, checkPortAvailable } from '../../gateway/ports.js';
import {
  createTokenCommand,
  createStatusCommand,
  createStopCommand,
  createRestartCommand,
  createLogsCommand,
  createInstallCommand,
  createUninstallCommand,
  createServiceStartCommand,
  createServiceStatusCommand,
} from './gateway/index.js';

const _log = createLogger('GatewayCommand');

function createGatewayCommand(_ctx: CLIContext): Command {
  const cmd = new Command('gateway')
    .description('Start the xopcbot gateway server')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot gateway                   # Start gateway (foreground, default)',
        'xopcbot gateway --background      # Start gateway in background',
        'xopcbot gateway --port 8080       # Custom port',
        'xopcbot gateway --force           # Force kill existing process',
        'xopcbot gateway stop             # Stop gateway',
        'xopcbot gateway restart          # Restart gateway',
        'xopcbot gateway status           # Check gateway status',
        'xopcbot gateway logs             # View recent logs',
        'xopcbot gateway token            # Show current token',
        'xopcbot gateway token --generate # Generate new token',
      ])
    )
    .option('--host <address>', 'Host to bind to', '0.0.0.0')
    .option('--port <number>', 'Port to listen on', '18790')
    .option('--token <token>', 'Authentication token')
    .option('--force', 'Force kill existing process on port', false)
    .option('--no-hot-reload', 'Disable config hot reload')
    .option('--foreground', 'Start gateway in foreground mode (blocks terminal)', true)
    .option('--background', 'Start gateway in background mode (detached)', false)
    .addCommand(createTokenCommand())
    .addCommand(createStatusCommand())
    .addCommand(createStopCommand())
    .addCommand(createRestartCommand())
    .addCommand(createLogsCommand())
    .addCommand(createInstallCommand())
    .addCommand(createUninstallCommand())
    .addCommand(createServiceStartCommand())
    .addCommand(createServiceStatusCommand())
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const port = parseInt(options.port, 10);
      const host = options.host;

      // --force: Force free port
      if (options.force) {
        try {
          const result = await forceFreePortAndWait(port, {
            timeoutMs: 2000,
            sigtermTimeoutMs: 700,
          });
          if (result.killed.length > 0) {
            console.log(`Force killed ${result.killed.length} process(es) on port ${port}`);
            if (result.escalatedToSigkill) {
              console.log('Escalated to SIGKILL');
            }
          }
        } catch (err) {
          console.error(`Failed to free port ${port}: ${String(err)}`);
          process.exit(1);
        }
      }

      // Check if port is available
      const portAvailable = await checkPortAvailable(port, host);
      if (!portAvailable) {
        console.error(`Port ${port} is already in use. Use --force to kill existing process.`);
        process.exit(1);
      }

      // Determine if background mode (default is foreground, --background overrides)
      const isBackground = options.background === true;

      // Background mode: spawn detached process
      if (isBackground) {
        console.log('🚀 Starting xopcbot gateway in background...');
        console.log(`   Host: ${host}`);
        console.log(`   Port: ${port}`);
        console.log('');

        const args = [
          ...process.execArgv,
          ...process.argv.slice(1).filter(arg => arg !== '--background'),
          '--foreground', // Force foreground mode in child to prevent infinite spawn loop
        ];

        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        });

        child.unref();

        // Wait a moment to check if process started successfully
        await new Promise(resolve => setTimeout(resolve, 500));

        if (child.pid && !child.killed) {
          const displayHost = host === '0.0.0.0' ? 'localhost' : host;
          console.log('✅ Gateway started in background');
          console.log(`   PID: ${child.pid}`);
          console.log(`   URL: http://${displayHost}:${port}`);
          const token = options.token || config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
          console.log('');
          console.log('📝 Management commands:');
          console.log(`   xopcbot gateway status     # Check status`);
          console.log(`   xopcbot gateway stop       # Stop gateway`);
          console.log(`   xopcbot gateway restart    # Restart gateway`);
          process.exit(0);
        } else {
          console.error('❌ Failed to start gateway in background');
          process.exit(1);
        }
        return;
      }

      // Foreground mode: Start gateway with run loop
      console.log('🚀 Starting xopcbot gateway...');
      console.log(`   Host: ${host}`);
      console.log(`   Port: ${port}`);
      console.log('');
      console.log('Press Ctrl+C to stop');
      console.log('');

      await runGatewayLoop({
        configPath: ctx.configPath || DEFAULT_PATHS.config,
        port,
        start: async () => {
          const server = new GatewayServer({
            host,
            port,
            token: options.token || config?.gateway?.auth?.token,
            verbose: ctx.isVerbose,
            configPath: ctx.configPath,
            enableHotReload: options.hotReload,
          });
          await server.start();

          const displayHost = host === '0.0.0.0' ? 'localhost' : host;
          const token = options.token || config?.gateway?.auth?.token;
          console.log('✅ Gateway started');
          console.log(`   URL: http://${displayHost}:${port}`);
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
          console.log('');

          return server;
        },
      });
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
      'xopcbot gateway --background',
      'xopcbot gateway --port 8080',
    ],
  },
});
