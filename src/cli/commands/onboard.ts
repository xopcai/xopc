import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { input, select, confirm } from '@inquirer/prompts';
import { saveConfig } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import { getFallbackTemplate as _getFallbackTemplate, TEMPLATE_FILES as _TEMPLATE_FILES } from '../templates.js';
import type { CLIContext } from '../registry.js';
import type { Config } from '../../config/schema.js';
import {
  anthropicOAuthProvider,
  minimaxOAuthProvider,
  minimaxCnOAuthProvider,
  kimiOAuthProvider,
  githubCopilotOAuthProvider,
  googleGeminiCliOAuthProvider,
  googleAntigravityOAuthProvider,
  openaiCodexOAuthProvider,
  type OAuthLoginCallbacks,
} from '../../auth/index.js';
import { upsertAuthProfile, listProfilesForProvider as _listProfilesForProvider } from '../../auth/profiles/index.js';
import {
  getModelsByProvider,
  getSortedProviders,
  getProviderDisplayName,
  providerSupportsOAuth,
  providerSupportsApiKey,
} from '../../providers/index.js';
import { colors } from '../utils/colors.js';
import { acquireGatewayLock, GatewayLockError } from '../../gateway/lock.js';

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
      config = await setupModel(config, ctx);
    }

    if (doChannels) {
      config = await setupChannels(config);
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

const OAUTH_PROVIDER_MAP = {
  anthropic: {
    provider: anthropicOAuthProvider,
    profileId: 'anthropic:default',
    displayName: 'Anthropic (Claude)',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  minimax: {
    provider: minimaxOAuthProvider,
    profileId: 'minimax:default',
    displayName: 'MiniMax',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'minimax-cn': {
    provider: minimaxCnOAuthProvider,
    profileId: 'minimax-cn:default',
    displayName: 'MiniMax CN',
    urlPrompt: '🌐 请在浏览器中打开以下 URL:\n',
  },
  kimi: {
    provider: kimiOAuthProvider,
    profileId: 'kimi:default',
    displayName: 'Kimi',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'github-copilot': {
    provider: githubCopilotOAuthProvider,
    profileId: 'github-copilot:default',
    displayName: 'GitHub Copilot',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'google-gemini-cli': {
    provider: googleGeminiCliOAuthProvider,
    profileId: 'google-gemini-cli:default',
    displayName: 'Google Gemini CLI',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'google-antigravity': {
    provider: googleAntigravityOAuthProvider,
    profileId: 'google-antigravity:default',
    displayName: 'Google Antigravity',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'openai-codex': {
    provider: openaiCodexOAuthProvider,
    profileId: 'openai-codex:default',
    displayName: 'OpenAI Codex',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
} as const;

async function doOAuthLogin(provider: string): Promise<boolean> {
  const config = OAUTH_PROVIDER_MAP[provider as keyof typeof OAUTH_PROVIDER_MAP];
  if (!config) {
    console.error(`OAuth not supported for provider: ${provider}`);
    return false;
  }

  console.log(`\n🔐 Starting ${config.displayName} OAuth login...`);

  const callbacks: OAuthLoginCallbacks = {
    onAuth: (info) => {
      console.log(`\n${config.urlPrompt}`);
      console.log(info.url);
      if (info.instructions) {
        console.log('\n' + info.instructions);
      }
      console.log('\n');
    },
    onPrompt: async (prompt) => {
      return input({ message: prompt.message });
    },
    onProgress: (message) => {
      console.log(' →', message);
    },
  };

  try {
    const creds = await config.provider.login(callbacks);
    upsertAuthProfile({
      profileId: config.profileId,
      credential: {
        type: 'oauth',
        provider,
        ...creds,
      },
    });
    return true;
  } catch (error) {
    console.error('❌ OAuth login failed:', error);
    return false;
  }
}

async function setupModel(config: Config, ctx: CLIContext): Promise<Config> {
  console.log(colors.cyan('\n🤖 Step 2: AI Model Configuration\n'));

  const providers = getSortedProviders();
  
  if (providers.length === 0) {
    console.log('⚠️  No providers available.');
    return config;
  }

  const providerChoices = providers.map(p => ({
    name: getProviderDisplayName(p),
    value: p,
  }));

  const selectedProvider = await select({
    message: 'Select AI provider:',
    choices: providerChoices,
  });

  console.log(`\n📦 Selected: ${getProviderDisplayName(selectedProvider)}`);

  const currentProviderConfig = (config as any).providers?.[selectedProvider];
  const hasExistingConfig = !!currentProviderConfig;

  const authMethods: string[] = [];
  if (providerSupportsOAuth(selectedProvider)) authMethods.push('oauth');
  if (providerSupportsApiKey(selectedProvider)) authMethods.push('api_key');

  if (authMethods.length === 0) {
    console.log('⚠️  No authentication methods available for this provider.');
    return config;
  }

  if (hasExistingConfig) {
    const reconfigure = await confirm({
      message: 'Provider already configured. Reconfigure?',
      default: false,
    });
    if (!reconfigure) {
      (config as any).agents = (config as any).agents || {};
      (config as any).agents.defaults = (config as any).agents.defaults || {};
      (config as any).agents.defaults.model = selectedProvider;
      await saveConfig(config, ctx.configPath);
      return config;
    }
  }

  let authMethod: string;
  if (authMethods.length === 1) {
    authMethod = authMethods[0];
  } else {
    authMethod = await select({
      message: 'Select authentication method:',
      choices: authMethods.map(m => ({
        name: m === 'oauth' ? 'OAuth (Browser Login)' : 'API Key',
        value: m,
      })),
    });
  }

  if (authMethod === 'oauth') {
    const success = await doOAuthLogin(selectedProvider);
    if (success) {
      console.log('✅ OAuth login successful!');
    } else {
      console.log('❌ OAuth login failed. Please try again or use API key.');
    }
  }

  if (authMethod === 'api_key') {
    const apiKey = await input({
      message: `Enter API key (${selectedProvider}):`,
      validate: (input) => input.length > 0 || 'API key is required',
    });

    (config as any).providers = (config as any).providers || {};
    (config as any).providers[selectedProvider] = {
      api_key: apiKey,
    };

    console.log('✅ API key saved.');
  }

  const models = await getModelsForProvider(selectedProvider);
  
  if (models.length === 0) {
    console.log('⚠️  No models available for this provider.');
  } else {
    const selectedModel = await select({
      message: 'Select model:',
      choices: models,
    });

    (config as any).agents = (config as any).agents || {};
    (config as any).agents.defaults = (config as any).agents.defaults || {};
    (config as any).agents.defaults.model = `${selectedProvider}/${selectedModel}`;
  }

  await saveConfig(config as Config, ctx.configPath);
  console.log('✅ Model configuration saved.\n');

  return config;
}

async function getModelsForProvider(provider: string): Promise<{ value: string; name: string }[]> {
  const models = getModelsByProvider(provider);
  
  if (!models || models.length === 0) {
    return [{ value: 'default', name: 'Default Model' }];
  }

  return models.map(m => ({
    value: m.id,
    name: m.name || m.id,
  }));
}

async function setupChannels(config: Config): Promise<Config> {
  console.log(colors.cyan('\n💬 Step 3: Messaging Channels\n'));

  const enableTelegram = await confirm({
    message: 'Enable Telegram channel?',
    default: true,
  });

  if (enableTelegram) {
    (config as any).channels = (config as any).channels || {};
    (config as any).channels.telegram = (config as any).channels.telegram || {};

    const hasToken = !!(config as any).channels.telegram.bot_token;
    
    if (!hasToken) {
      console.log('\n📝 Telegram Configuration:');
      console.log('   Get your bot token from @BotFather on Telegram.\n');

      const botToken = await input({
        message: 'Enter Telegram Bot Token:',
        validate: (input) => input.length > 0 || 'Bot token is required',
      });

      (config as any).channels.telegram.bot_token = botToken;
      console.log('✅ Telegram configured.');
    } else {
      console.log('ℹ️  Telegram already configured.');
    }
  }

  const enableSlack = await confirm({
    message: 'Enable Slack channel?',
    default: false,
  });

  if (enableSlack) {
    (config as any).channels = (config as any).channels || {};
    (config as any).channels.slack = (config as any).channels.slack || {};

    console.log('\n📝 Slack Configuration:');
    console.log('   Create a Slack app at https://api.slack.com/apps\n');

    const botToken = await input({
      message: 'Enter Slack Bot Token (xoxb-...):',
      validate: (input) => input.length > 0 || 'Bot token is required',
    });

    const signingSecret = await input({
      message: 'Enter Slack Signing Secret:',
      validate: (input) => input.length > 0 || 'Signing secret is required',
    });

    (config as any).channels.slack.bot_token = botToken;
    (config as any).channels.slack.signing_secret = signingSecret;
    console.log('✅ Slack configured.');
  }

  const enableDiscord = await confirm({
    message: 'Enable Discord channel?',
    default: false,
  });

  if (enableDiscord) {
    (config as any).channels = (config as any).channels || {};
    (config as any).channels.discord = (config as any).channels.discord || {};

    console.log('\n📝 Discord Configuration:');
    console.log('   Create a bot at https://discord.com/developers/applications\n');

    const botToken = await input({
      message: 'Enter Discord Bot Token:',
      validate: (input) => input.length > 0 || 'Bot token is required',
    });

    (config as any).channels.discord.bot_token = botToken;
    console.log('✅ Discord configured.');
  }

  return config;
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
