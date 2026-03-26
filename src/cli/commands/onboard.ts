import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { input, select, confirm } from '@inquirer/prompts';
import { saveConfig } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import { getFallbackTemplate as _getFallbackTemplate, TEMPLATE_FILES as _TEMPLATE_FILES } from '../templates.js';
import type { CLIContext } from '../registry.js';
import type { Config } from '../../config/schema.js';
import { setupModel as runModelSetup } from './onboard/model.js';
import { colors } from '../utils/colors.js';
import { acquireGatewayLock, GatewayLockError } from '../../gateway/lock.js';
import { setupChannels as runChannelOnboard, getChannelConfigurators } from './onboard/channels/index.js';

// Import workspace utilities
import { isWorkspaceSetup, setupWorkspace as _setupWorkspace, isConfigSetup as _isConfigSetup, setupConfig as _setupConfig, quickSetup } from '../utils/workspace.js';

/**
 * Load raw config without schema parsing to avoid default values being added.
 * This preserves the user's original config structure during onboard.
 */
function loadRawConfig(configPath: string): Config | null {
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as Config;
  } catch {
    return null;
  }
}

function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

async function setupNonInteractive(_configPath: string, existingConfig: Config | null): Promise<Config | null> {
  console.log('\n🤖 AI Model Configuration (Non-Interactive Mode)\n');
  console.log('Current config:', JSON.stringify(existingConfig?.agents?.defaults?.model, null, 2));
  console.log('\n💡 To configure in interactive mode, run: xopcbot onboard');
  console.log('💡 Or set up manually in:', _configPath);
  return existingConfig;
}

function createOnboardCommand(ctx: CLIContext): Command {
  const cmd = new Command('onboard')
    .description('Interactive setup wizard for xopcbot')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot onboard              # Full interactive setup',
        'xopcbot onboard --model      # Configure LLM model only',
        'xopcbot onboard --channels   # Configure channels only',
        'xopcbot onboard --gateway    # Configure gateway only',
      ])
    )
    .option('--model', 'Configure LLM provider and model')
    .option('--channels', 'Configure messaging channels')
    .option('--gateway', 'Configure gateway WebUI')
    .option('--all', 'Configure everything (default)')
    .action(async (options) => {
      try {
        await runOnboard(options, ctx);
      } catch (error: unknown) {
        const err = error as { name?: string; code?: string };
        if (err?.name === 'ExitPromptError' || err?.code === 'EXIT_PROMPT') {
          console.log('\n\n👋 Setup cancelled.');
          process.exit(0);
        }
        throw error;
      }
    });

  return cmd;
}

async function runOnboard(
  options: { model?: boolean; channels?: boolean; gateway?: boolean; all?: boolean },
  ctx: CLIContext
): Promise<void> {
  console.log(colors.cyan('\n🚀 Welcome to xopcbot setup!\n'));
  console.log('═'.repeat(50));

  const workspacePath = ctx.workspacePath;
  const configPath = ctx.configPath;

  // Use raw config loading to avoid schema defaults being added
  let config = loadRawConfig(configPath) || ({} as Config);

  // Determine what to configure based on options
  const doModel = options.model || options.all || (!options.channels && !options.gateway);
  const doChannels = options.channels || options.all || (!options.model && !options.gateway);
  const doGateway = options.gateway || options.all || (!options.model && !options.channels);
  const runFullWizard = !options.model && !options.channels && !options.gateway;

  // Auto-detect if setup is needed (for full wizard only)
  const needsSetup = !isWorkspaceSetup(workspacePath);

  if (runFullWizard && needsSetup) {
    console.log('\n📁 Step 1: Workspace Setup\n');
    quickSetup(workspacePath);
  }

  if (!isInteractive()) {
    // Non-interactive mode
    if (doModel) {
      config = await setupNonInteractive(configPath, config);
    }
    if (doChannels) {
      console.log('\n💬 Channels Configuration (Non-Interactive Mode)\n');
      console.log('💡 To configure channels, edit the config file manually.');
    }
    if (doGateway) {
      console.log('\n🌐 Gateway Configuration (Non-Interactive Mode)\n');
      console.log('💡 To configure gateway, edit the config file manually.');
    }
  } else {
    // Interactive mode
    if (doModel) {
      config = await runModelSetup(config, ctx);
    }

    if (doChannels) {
      const channelIds = getChannelConfigurators().map(c => c.id);
      console.log(colors.gray(`\nChannel onboarding: ${channelIds.join(', ')}\n`));
      config = await runChannelOnboard(config);
    }

    if (doGateway) {
      config = await setupGateway(config);
    }
  }

  // Save config once at the end
  await saveConfig(config as Config, configPath);

  console.log('\n' + '═'.repeat(50));
  console.log('\n🎉 Setup Complete!\n');

  if (runFullWizard) {
    console.log('🚀 Next Steps:');
    console.log('  1. Read BOOTSTRAP.md in your workspace for first-run guidance');
    console.log('  2. Chat with your assistant: xopcbot agent -i');
    console.log('');
  }

  console.log('📝 Usage:');
  console.log('  xopcbot agent -m "Hello"    # Chat with AI');
  console.log('  xopcbot agent -i            # Interactive mode');
  console.log('  xopcbot models list         # List models');
  console.log('  xopcbot auth list           # View authentication');

  console.log('\n📁 Files:');
  console.log('  Config:', configPath);
  console.log('  Workspace:', workspacePath);
  if (runFullWizard) {
    console.log('  Bootstrap:', join(workspacePath, 'BOOTSTRAP.md'));
  }

  // Handle gateway startup if configured
  const gatewayConfigured = (config as any)?.gateway?.auth?.mode === 'token' && (config as any)?.gateway?.auth?.token;

  if (gatewayConfigured && (doGateway || runFullWizard)) {
    const host = (config as any)?.gateway?.host || '0.0.0.0';
    const port = (config as any)?.gateway?.port || 18790;
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    const token = (config as any).gateway.auth.token;

    const webuiUrl = `http://${displayHost}:${port}?token=${token}`;

    console.log('\n🌐 WebUI Access:');
    console.log(`  URL: http://${displayHost}:${port}`);
    console.log(`  Token: ${token?.slice(0, 8)}...${token?.slice(-8)}`);
    console.log('');
    console.log('  Direct Access URL (with token):');
    console.log(`    ${webuiUrl}`);
    console.log('');

    await startGatewayNow(config as Config, ctx);
  }

  process.exit(0);
}

async function startGatewayNow(config: Config, ctx: CLIContext): Promise<void> {
  const host = (config as any)?.gateway?.host || '0.0.0.0';
  const port = (config as any)?.gateway?.port || 18790;
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;

  let isRunning = false;
  try {
    const lock = await acquireGatewayLock(ctx.configPath, { timeoutMs: 100, port });
    await lock.release();
  } catch (err) {
    if (err instanceof GatewayLockError) {
      isRunning = true;
    }
  }

  if (isRunning) {
    console.log('\n🌐 Gateway is already running!');
    console.log(`   URL: http://${displayHost}:${port}`);
    console.log('');
    console.log('📝 To apply the new configuration, restart gateway:');
    console.log('   xopcbot gateway restart');
  } else {
    if (isInteractive()) {
      const shouldStart = await confirm({
        message: 'Start Gateway WebUI now (background mode)?',
        default: true,
      });

      if (shouldStart) {
        console.log('\n🚀 Starting Gateway WebUI in background...');
        console.log('');

        const { spawn } = await import('child_process');
        const args = [
          ...process.execArgv,
          ...process.argv.slice(1).filter(arg => !arg.includes('onboard') && arg !== '--quick'),
          'gateway',
          '--background',
          '--host', host,
          '--port', String(port),
        ];

        const child = spawn(process.execPath, args, {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        });

        child.unref();

        await new Promise(resolve => setTimeout(resolve, 500));

        if (child.pid && !child.killed) {
          console.log('✅ Gateway started in background');
          console.log(`   PID: ${child.pid}`);
          console.log(`   URL: http://${displayHost}:${port}`);
          const token = (config as any)?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
        } else {
          console.log('⚠️  Failed to start gateway automatically.');
          console.log('   You can start it manually with:');
          console.log(`   xopcbot gateway --background`);
        }
      } else {
        console.log('\n⏭️  Skipping gateway startup.');
        console.log('   You can start it later with:');
        console.log(`   xopcbot gateway --background`);
      }
    } else {
      console.log('\n🚀 Gateway is configured but not running.');
      console.log('');
      console.log('📝 To start the gateway in background:');
      console.log(`   xopcbot gateway --background`);
      console.log('');
      console.log('📝 To start in foreground (development mode):');
      console.log(`   pnpm run dev -- gateway --host ${host} --port ${port}`);
    }
  }

  console.log('');
  console.log('📚 Other useful commands:');
  console.log('   xopcbot gateway status    # Check gateway status');
  console.log('   xopcbot gateway stop      # Stop gateway');
  console.log('   xopcbot gateway restart   # Restart gateway');
  console.log('   xopcbot gateway logs      # View logs');
}

async function setupGateway(config: Config): Promise<Config> {
  console.log(colors.cyan('\n🌐 Step 4: Gateway WebUI\n'));

  const enableGateway = await confirm({
    message: 'Enable Gateway WebUI?',
    default: true,
  });

  if (!enableGateway) {
    console.log('ℹ️  Gateway skipped.');
    return config;
  }

  const host = await select({
    message: 'Bind address:',
    choices: [
      { name: 'Localhost only (127.0.0.1)', value: '127.0.0.1' },
      { name: 'All interfaces (0.0.0.0)', value: '0.0.0.0' },
    ],
    default: '0.0.0.0',
  });

  const portInput = await input({
    message: 'Port:',
    default: '18790',
    validate: (input) => {
      const port = parseInt(input, 10);
      return !isNaN(port) && port > 0 && port < 65536 || 'Invalid port number';
    },
  });

  const port = parseInt(portInput, 10);

  const authMode = await select({
    message: 'Authentication:',
    choices: [
      { name: 'Token (recommended)', value: 'token' },
      { name: 'None (local only)', value: 'none' },
    ],
    default: 'token',
  });

  let token: string | undefined;
  if (authMode === 'token') {
    const existingToken = (config as any)?.gateway?.auth?.token;
    if (existingToken) {
      const reuse = await confirm({
        message: 'Use existing token?',
        default: true,
      });
      if (reuse) {
        token = existingToken;
      }
    }

    if (!token) {
      const crypto = await import('crypto');
      token = crypto.randomBytes(24).toString('hex');
      console.log(`\n🔑 Generated token: ${token.slice(0, 8)}...${token.slice(-8)}`);
    }
  }

  (config as any).gateway = (config as any).gateway || {};
  (config as any).gateway.host = host;
  (config as any).gateway.port = port;
  (config as any).gateway.auth = {
    mode: authMode,
    ...(token ? { token } : {}),
  };

  console.log('✅ Gateway configuration saved.\n');

  return config;
}

register({
  id: 'onboard',
  name: 'onboard',
  description: 'Interactive setup wizard',
  factory: createOnboardCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopcbot onboard',
      'xopcbot onboard --model',
      'xopcbot onboard --channels',
    ],
  },
});
