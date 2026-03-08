import { Command } from 'commander';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { GatewayServer } from '../../gateway/index.js';
import { loadConfig, saveConfig, DEFAULT_PATHS } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import { runGatewayLoop } from '../../gateway/run-loop.js';
import { acquireGatewayLock, GatewayLockError } from '../../gateway/lock.js';
import { forceFreePortAndWait, checkPortAvailable, listPortListeners } from '../../gateway/ports.js';

const log = createLogger('GatewayCommand');

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
        const config = loadConfig(configPath);

        if (options.generate) {
          const newToken = crypto.randomBytes(24).toString('hex');

          config.gateway = config.gateway || {};
          config.gateway.auth = {
            mode: 'token',
            token: newToken,
          };

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
          process.exit(0);
        } else {
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
          process.exit(0);
        }
      } catch (error) {
        log.error({ err: error }, 'Failed to manage token');
        process.exit(1);
      }
    });
}

/**
 * Create status subcommand
 */
function createStatusCommand(): Command {
  return new Command('status')
    .description('Check gateway status')
    .action(async () => {
      const ctx = getContextWithOpts();
      const configPath = ctx.configPath || DEFAULT_PATHS.config;
      const config = loadConfig(configPath);
      const port = config?.gateway?.port || 18790;

      try {
        // Try to acquire lock - if successful, gateway is not running
        const lock = await acquireGatewayLock(configPath, { timeoutMs: 100, port });
        await lock.release();
        console.log('⚠️  Gateway is not running');
        console.log('\n💡 Start with: xopcbot gateway');
        process.exit(0);
      } catch (err) {
        if (err instanceof GatewayLockError) {
          console.log('✅ Gateway is running');
          console.log(`   Port: ${port}`);

          // Try to get more info from lock file
          // This is a simplified version - could be enhanced
          console.log('');
          console.log('🌐 Access:');
          const host = 'localhost';
          console.log(`   URL: http://${host}:${port}`);

          const token = config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }

          console.log('');
          console.log('📝 Management:');
          console.log('   xopcbot gateway stop      # Stop gateway');
          console.log('   xopcbot gateway restart   # Restart gateway');
          process.exit(0);
        } else {
          console.error('❌ Failed to check status:', err);
          process.exit(1);
        }
      }
    });
}

/**
 * Create stop subcommand
 */
function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop running gateway')
    .option('--force', 'Force kill immediately', false)
    .option('--timeout <ms>', 'Timeout before force kill', '5000')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const port = config?.gateway?.port || 18790;

      // Check if gateway is running by trying to acquire lock
      try {
        const lock = await acquireGatewayLock(ctx.configPath || DEFAULT_PATHS.config, {
          timeoutMs: 100,
          port,
        });
        await lock.release();
        console.log('ℹ️  Gateway is not running');
        process.exit(0);
      } catch {
        // Lock exists, gateway is running
      }

      console.log('🛑 Stopping gateway...');

      try {
        const listeners = listPortListeners(port);
        if (listeners.length === 0) {
          console.log('ℹ️  No process found listening on port');
          process.exit(0);
        }

        const timeout = parseInt(options.timeout, 10);

        if (options.force) {
          // Force kill immediately
          for (const proc of listeners) {
            try {
              process.kill(proc.pid, 'SIGKILL');
              console.log(`   Killed pid ${proc.pid}`);
            } catch (err) {
              console.warn(`   Failed to kill pid ${proc.pid}: ${String(err)}`);
            }
          }
        } else {
          // Graceful shutdown
          const result = await forceFreePortAndWait(port, {
            timeoutMs: timeout,
            sigtermTimeoutMs: Math.min(2000, timeout / 2),
          });

          if (result.killed.length > 0) {
            for (const proc of result.killed) {
              console.log(`   Stopped pid ${proc.pid}`);
            }
            if (result.escalatedToSigkill) {
              console.log('   Escalated to SIGKILL');
            }
          }
        }

        console.log('✅ Gateway stopped');
        process.exit(0);
      } catch (err) {
        console.error('❌ Failed to stop gateway:', err);
        process.exit(1);
      }
    });
}

/**
 * Create restart subcommand
 */
function createRestartCommand(): Command {
  return new Command('restart')
    .description('Restart gateway')
    .option('--force', 'Force restart (kill if needed)', false)
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const port = config?.gateway?.port || 18790;
      const host = config?.gateway?.host || '0.0.0.0';

      // Find existing process
      const listeners = listPortListeners(port);

      if (listeners.length === 0) {
        // Gateway is not running, start it in background
        console.log('🚀 Gateway is not running, starting...');
        console.log(`   Host: ${host}`);
        console.log(`   Port: ${port}`);
        console.log('');

        const args = process.argv.slice(1).filter(arg => 
          arg !== 'restart' && !arg.startsWith('--force')
        );
        args.push('--background');

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
          console.log('✅ Gateway started');
          console.log(`   PID: ${child.pid}`);
          console.log(`   URL: http://${displayHost}:${port}`);
          const token = config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
          process.exit(0);
        } else {
          console.error('❌ Failed to start gateway');
          process.exit(1);
        }
        return;
      }

      if (options.force) {
        // Force kill then start new
        console.log('🔄 Force restarting gateway...');
        try {
          await forceFreePortAndWait(port, {
            timeoutMs: 2000,
            sigtermTimeoutMs: 700,
          });
          console.log('✅ Gateway stopped');
          console.log('');

          // Start new instance in background
          const args = process.argv.slice(1).filter(arg => 
            arg !== 'restart' && !arg.startsWith('--force')
          );
          args.push('--background');

          const child = spawn(process.execPath, args, {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          });

          child.unref();

          await new Promise(resolve => setTimeout(resolve, 500));

          if (child.pid && !child.killed) {
            const displayHost = host === '0.0.0.0' ? 'localhost' : host;
            console.log('✅ Gateway started');
            console.log(`   PID: ${child.pid}`);
            console.log(`   URL: http://${displayHost}:${port}`);
            process.exit(0);
          } else {
            console.error('❌ Failed to start gateway');
            process.exit(1);
          }
        } catch (err) {
          console.error('❌ Failed to stop gateway:', err);
          process.exit(1);
        }
        return;
      }

      // Send SIGUSR1 to trigger graceful restart
      for (const proc of listeners) {
        try {
          // Enable SIGUSR1 restart temporarily
          process.env.XOPCBOT_ALLOW_SIGUSR1_RESTART = '1';
          process.kill(proc.pid, 'SIGUSR1');
          console.log(`✅ Restart signal sent to gateway (pid ${proc.pid})`);
          console.log('   Gateway will restart gracefully...');
          process.exit(0);
        } catch (err) {
          console.error(`❌ Failed to send restart signal: ${String(err)}`);
        }
      }
      process.exit(1);
    });
}

/**
 * Create logs subcommand
 */
function createLogsCommand(): Command {
  return new Command('logs')
    .description('View gateway logs')
    .option('--lines <n>', 'Number of lines to show', '50')
    .option('--follow', 'Follow log output (like tail -f)')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      
      // Determine log directory from environment or default
      const logDir = process.env.XOPCBOT_LOG_DIR || 
        `${ctx.configPath.replace('/config.json', '')}/logs`;
      
      // Find the latest gateway log file
      const { existsSync, readdirSync } = await import('fs');
      const { join } = await import('path');
      
      if (!existsSync(logDir)) {
        console.log('ℹ️  No log directory found');
        process.exit(0);
      }
      
      // Look for gateway log files (format: gateway-YYYY-MM-DD.log)
      const files = readdirSync(logDir)
        .filter(f => f.startsWith('gateway-') && f.endsWith('.log'))
        .sort()
        .reverse();
      
      if (files.length === 0) {
        console.log('ℹ️  No gateway log files found');
        process.exit(0);
      }
      
      const logFile = join(logDir, files[0]);

      console.log(`📄 Log file: ${logFile}`);
      console.log('');

      try {
        const { exec } = await import('child_process');
        const lines = parseInt(options.lines, 10);
        
        const cmd = process.platform === 'win32'
          ? `powershell -Command "Get-Content '${logFile}' -Tail ${lines}"`
          : `tail -n ${lines} "${logFile}"`;

        if (options.follow) {
          console.log('ℹ️  Follow mode: Use Ctrl+C to exit\n');
          const followCmd = process.platform === 'win32'
            ? `powershell -Command "Get-Content '${logFile}' -Wait"`
            : `tail -f "${logFile}"`;
          
          const child = exec(followCmd);
          child.stdout?.on('data', (data) => process.stdout.write(data.toString()));
          child.stderr?.on('data', (data) => process.stderr.write(data.toString()));
          
          process.on('SIGINT', () => {
            child.kill();
            process.exit(0);
          });
        } else {
          const { execSync } = await import('child_process');
          const output = execSync(cmd, { encoding: 'utf-8' });
          console.log(output);
          process.exit(0);
        }
      } catch (err) {
        console.error('❌ Failed to read logs:', err);
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
      'xopcbot gateway --force',
      'xopcbot gateway stop',
      'xopcbot gateway restart',
      'xopcbot gateway status',
      'xopcbot gateway logs',
      'xopcbot gateway token',
      'xopcbot gateway token --generate',
    ],
  },
});
