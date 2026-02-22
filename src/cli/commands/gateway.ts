import { Command } from 'commander';
import crypto from 'crypto';
import { GatewayServer } from '../../gateway/index.js';
import { loadConfig, saveConfig, DEFAULT_PATHS } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import { GatewayProcessManager } from '../../gateway/process-manager.js';
import type { GatewayProcessConfig } from '../../gateway/process-manager.types.js';

const log = createLogger('GatewayCommand');

function createGatewayCommand(_ctx: CLIContext): Command {
  const cmd = new Command('gateway')
    .description('Start the xopcbot gateway server')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot gateway                   # Start with default port (foreground)',
        'xopcbot gateway --port 8080       # Custom port',
        'xopcbot gateway --host 127.0.0.1  # Bind to localhost only',
        'xopcbot gateway --token secret    # Enable authentication',
        'xopcbot gateway --no-hot-reload   # Disable config hot reload',
        'xopcbot gateway --background      # Run in background (daemon mode)',
        'xopcbot gateway --bg              # Shorthand for --background',
        'xopcbot gateway status            # Check gateway status',
        'xopcbot gateway stop              # Stop running gateway',
        'xopcbot gateway restart           # Restart gateway',
        'xopcbot gateway logs              # View recent logs',
        'xopcbot gateway token             # Show current token',
        'xopcbot gateway token --generate  # Generate new token',
      ])
    )
    .option('--host <address>', 'Host to bind to', '0.0.0.0')
    .option('--port <number>', 'Port to listen on', '18790')
    .option('--token <token>', 'Authentication token')
    .option('--no-hot-reload', 'Disable config hot reload')
    .option('-b, --background', 'Run in background (daemon mode)')
    .option('--log-file <path>', 'Log file path for background mode')
    .addCommand(createTokenCommand())
    .addCommand(createStatusCommand())
    .addCommand(createStopCommand())
    .addCommand(createRestartCommand())
    .addCommand(createLogsCommand())
    .action(async (options) => {
      const ctx = getContextWithOpts();
      
      // Load config for token and other settings
      const config = loadConfig(ctx.configPath);
      
      // Background mode: use process manager
      if (options.background) {
        await startBackgroundMode(options, ctx, config);
        return;
      }
      
      // Foreground mode: use GatewayServer directly
      await startForegroundMode(options, ctx, config);
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

/**
 * Start gateway in background mode using process manager
 */
async function startBackgroundMode(
  options: any,
  ctx: CLIContext,
  config: any
): Promise<void> {
  const manager = new GatewayProcessManager();
  
  // Check if already running
  if (manager.isRunning()) {
    const status = manager.getStatus();
    console.log('⚠️  Gateway is already running');
    if (status.pid) {
      console.log(`   PID: ${status.pid}`);
    }
    if (status.uptime) {
      const minutes = Math.floor(status.uptime / 60000);
      const seconds = Math.floor((status.uptime % 60000) / 1000);
      console.log(`   Uptime: ${minutes}m ${seconds}s`);
    }
    console.log('\n💡 Use "xopcbot gateway restart" to restart');
    console.log('💡 Use "xopcbot gateway stop" to stop');
    console.log('💡 Use "xopcbot gateway status" to check status');
    return;
  }

  const processConfig: GatewayProcessConfig = {
    host: options.host,
    port: parseInt(options.port, 10),
    token: options.token || config?.gateway?.auth?.token,
    configPath: ctx.configPath,
    verbose: ctx.isVerbose,
    background: true,
    logFile: options.logFile,
    enableHotReload: options.hotReload,
  };

  console.log('🚀 Starting gateway in background mode...');
  
  const result = await manager.start(processConfig);
  
  if (result.success) {
    const host = options.host === '0.0.0.0' ? 'localhost' : options.host;
    const token = processConfig.token;
    
    console.log('✅ Gateway started successfully');
    console.log(`   PID: ${result.pid}`);
    console.log(`   Host: ${options.host}`);
    console.log(`   Port: ${options.port}`);
    console.log('');
    console.log('🌐 WebUI Access:');
    console.log(`   URL: http://${host}:${options.port}`);
    
    if (token) {
      console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
      console.log(`   Direct URL: http://${host}:${options.port}?token=${token}`);
    }
    
    console.log('');
    console.log('📝 Management Commands:');
    console.log('   xopcbot gateway status    # Check status');
    console.log('   xopcbot gateway stop      # Stop gateway');
    console.log('   xopcbot gateway restart   # Restart gateway');
    console.log('   xopcbot gateway logs      # View logs');
    
    const logFile = manager.getLogFile();
    console.log(`   Log file: ${logFile}`);
  } else {
    console.error('❌ Failed to start gateway');
    if (result.portInUse) {
      console.error('\n' + result.error);
    } else if (result.error) {
      console.error(`   ${result.error}`);
    }
    process.exit(1);
  }
}

/**
 * Start gateway in foreground mode (traditional)
 */
async function startForegroundMode(
  options: any,
  ctx: CLIContext,
  config: any
): Promise<void> {
  const server = new GatewayServer({
    host: options.host,
    port: parseInt(options.port, 10),
    token: options.token || config?.gateway?.auth?.token,
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
}

/**
 * Create status subcommand
 */
function createStatusCommand(): Command {
  return new Command('status')
    .description('Check gateway status')
    .action(() => {
      const manager = new GatewayProcessManager();
      const status = manager.getStatus();
      
      if (!status.running) {
        console.log('⚠️  Gateway is not running');
        console.log('\n💡 Start with: xopcbot gateway --background');
        return;
      }
      
      console.log('✅ Gateway is running');
      console.log('');
      console.log(`   PID: ${status.pid}`);
      console.log(`   Host: ${status.host}`);
      console.log(`   Port: ${status.port}`);
      
      if (status.uptime) {
        const minutes = Math.floor(status.uptime / 60000);
        const seconds = Math.floor((status.uptime % 60000) / 1000);
        console.log(`   Uptime: ${minutes}m ${seconds}s`);
      }
      
      if (status.health) {
        console.log(`   Health: ${status.health}`);
      }
      
      console.log('');
      console.log('🌐 Access:');
      const host = status.host === '0.0.0.0' ? 'localhost' : status.host;
      console.log(`   URL: http://${host}:${status.port}`);
      
      // Load config to show token info
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const token = config?.gateway?.auth?.token;
      if (token) {
        console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
        console.log(`   Direct: http://${host}:${status.port}?token=${token}`);
      }
      
      console.log('');
      console.log('📝 Management:');
      console.log('   xopcbot gateway stop      # Stop gateway');
      console.log('   xopcbot gateway restart   # Restart gateway');
      console.log('   xopcbot gateway logs      # View logs');
    });
}

/**
 * Create stop subcommand
 */
function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop running gateway')
    .option('--force', 'Force kill immediately')
    .option('--timeout <ms>', 'Timeout before force kill', '5000')
    .action(async (options) => {
      const manager = new GatewayProcessManager();
      
      if (!manager.isRunning()) {
        console.log('ℹ️  Gateway is not running');
        return;
      }
      
      console.log('🛑 Stopping gateway...');
      
      const result = await manager.stop({
        force: options.force,
        timeout: parseInt(options.timeout, 10),
      });
      
      if (result.success) {
        console.log('✅ Gateway stopped');
        if (result.wasRunning === false) {
          console.log('ℹ️  Gateway was not running');
        }
      } else {
        console.error('❌ Failed to stop gateway');
        if (result.error) {
          console.error(`   ${result.error}`);
        }
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
    .option('--host <address>', 'Host to bind to')
    .option('--port <number>', 'Port to listen on')
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const manager = new GatewayProcessManager();
      
      // Load existing config or use defaults
      const processConfig: GatewayProcessConfig = {
        host: options.host || config?.gateway?.host || '0.0.0.0',
        port: parseInt(options.port || config?.gateway?.port || '18790', 10),
        token: config?.gateway?.auth?.token,
        configPath: ctx.configPath,
        background: true,
        enableHotReload: true,
      };
      
      console.log('🔄 Restarting gateway...');
      
      try {
        await manager.restart(processConfig);
        console.log('✅ Gateway restarted successfully');
        
        const status = manager.getStatus();
        if (status.pid) {
          console.log(`   PID: ${status.pid}`);
        }
        
        const host = processConfig.host === '0.0.0.0' ? 'localhost' : processConfig.host;
        console.log(`   URL: http://${host}:${processConfig.port}`);
      } catch (error) {
        console.error('❌ Failed to restart gateway');
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`   ${errorMsg}`);
        process.exit(1);
      }
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
      const manager = new GatewayProcessManager();
      const logFile = manager.getLogFile();
      
      if (!manager.isRunning()) {
        console.log('⚠️  Gateway is not running');
      }
      
      console.log(`📄 Log file: ${logFile}`);
      console.log('');
      
      const logs = await manager.getLogs({ lines: parseInt(options.lines, 10) });
      
      if (!logs) {
        console.log('ℹ️  No logs available');
        return;
      }
      
      console.log(logs);
      
      if (options.follow) {
        console.log('\nℹ️  Follow mode: Use Ctrl+C to exit');
        // Simple follow implementation
        const { exec } = await import('child_process');
        const cmd = process.platform === 'win32'
          ? `powershell -Command "Get-Content '${logFile}' -Wait"`
          : `tail -f "${logFile}"`;
        
        const child = exec(cmd);
        child.stdout?.on('data', (data) => {
          process.stdout.write(data.toString());
        });
        child.stderr?.on('data', (data) => {
          process.stderr.write(data.toString());
        });
        
        process.on('SIGINT', () => {
          child.kill();
          process.exit(0);
        });
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
      'xopcbot gateway --background',
      'xopcbot gateway status',
      'xopcbot gateway stop',
      'xopcbot gateway restart',
      'xopcbot gateway logs',
      'xopcbot gateway token',
      'xopcbot gateway token --generate',
    ],
  },
});
