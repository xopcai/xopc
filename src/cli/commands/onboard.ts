import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { input, select, confirm } from '@inquirer/prompts';
import { saveConfig } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import { getFallbackTemplate, TEMPLATE_FILES } from '../templates.js';
import type { CLIContext } from '../registry.js';
import type { Config } from '../../config/schema.js';
import {
  AuthStorage,
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
import { upsertAuthProfile, listProfilesForProvider } from '../../auth/profiles/index.js';
import {
  getModelsByProvider,
  getSortedProviders,
  getProviderDisplayName,
  providerSupportsOAuth,
  providerSupportsApiKey,
} from '../../providers/index.js';
import { colors } from '../utils/colors.js';
import { homedir } from 'os';
import { acquireGatewayLock, GatewayLockError } from '../../gateway/lock.js';

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

/**
 * Check if workspace is properly set up
 */
function isWorkspaceSetup(workspacePath: string): boolean {
  return existsSync(workspacePath) && existsSync(join(workspacePath, 'AGENTS.md'));
}

/**
 * Setup workspace directory and bootstrap files
 */
function setupWorkspace(workspacePath: string): void {
  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
    console.log('✅ Created workspace:', workspacePath);
  } else {
    console.log('ℹ️  Workspace already exists:', workspacePath);
  }

  // Use built-in templates (no frontmatter)
  const memoryDir = join(workspacePath, 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log('✅ Created memory/ directory');
  }

  for (const filename of TEMPLATE_FILES) {
    const filePath = join(workspacePath, filename);
    if (!existsSync(filePath)) {
      const content = getFallbackTemplate(filename);
      writeFileSync(filePath, content, 'utf-8');
      console.log('✅ Created', filename);
    }
  }
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
        // Handle user cancellation gracefully (Ctrl+C)
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
    setupWorkspace(workspacePath);
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
  const gatewayConfigured = config?.gateway?.auth?.mode === 'token' && config?.gateway?.auth?.token;

  if (gatewayConfigured && (doGateway || runFullWizard)) {
    const host = config?.gateway?.host || '0.0.0.0';
    const port = config?.gateway?.port || 18790;
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    const token = config.gateway.auth.token;

    const webuiUrl = `http://${displayHost}:${port}?token=${token}`;

    console.log('\n🌐 WebUI Access:');
    console.log(`  URL: http://${displayHost}:${port}`);
    console.log(`  Token: ${token?.slice(0, 8)}...${token?.slice(-8)}`);
    console.log('');
    console.log('  Direct Access URL (with token):');
    console.log(`    ${webuiUrl}`);
    console.log('');

    // Auto-start gateway after onboarding
    await startGatewayNow(config, ctx);
  }

  // Explicitly exit to prevent hanging
  process.exit(0);
}

/**
 * Handle gateway startup after onboarding.
 * In interactive mode, asks user if they want to start gateway in background.
 * In non-interactive mode, provides guidance on how to start manually.
 */
async function startGatewayNow(config: Config, ctx: CLIContext): Promise<void> {
  const host = config?.gateway?.host || '0.0.0.0';
  const port = config?.gateway?.port || 18790;
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;

  // Check if gateway is already running by trying to acquire lock
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
    // Gateway is running - provide restart guidance
    console.log('\n🌐 Gateway is already running!');
    console.log(`   URL: http://${displayHost}:${port}`);
    console.log('');
    console.log('📝 To apply the new configuration, restart gateway:');
    console.log('   xopcbot gateway restart');
  } else {
    // Gateway is not running
    if (isInteractive()) {
      // Interactive mode: ask user if they want to start gateway
      const shouldStart = await confirm({
        message: 'Start Gateway WebUI now (background mode)?',
        default: true,
      });

      if (shouldStart) {
        console.log('\n🚀 Starting Gateway WebUI in background...');
        console.log('');

        // Use spawn to start gateway in background
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

        // Wait a moment to check if process started successfully
        await new Promise(resolve => setTimeout(resolve, 500));

        if (child.pid && !child.killed) {
          console.log('✅ Gateway started in background');
          console.log(`   PID: ${child.pid}`);
          console.log(`   URL: http://${displayHost}:${port}`);
          const token = config?.gateway?.auth?.token;
          if (token) {
            console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
          }
        } else {
          console.log('⚠️  Failed to start gateway automatically.');
          console.log('   You can start it manually with:');
          console.log(`   xopcbot gateway --background`);
        }
      } else {
        // User chose not to start
        console.log('\n⏭️  Skipping gateway startup.');
        console.log('   You can start it later with:');
        console.log(`   xopcbot gateway --background`);
      }
    } else {
      // Non-interactive mode: provide guidance
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

// OAuth provider configuration map
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

// TODO: Remove old OAuth login code below this line
async function _doOAuthLoginOld(provider: string): Promise<boolean> {
  console.log('\n🔐 Starting OAuth login...');

  if (provider === 'anthropic') {
    const authPath = join(homedir(), '.xopcbot', 'auth.json');
    const authStorage = new AuthStorage({ filename: authPath });
    authStorage.registerOAuthProvider(anthropicOAuthProvider);

    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        console.log('\n🌐 Please open this URL in your browser:\n');
        console.log(info.url);
        console.log('\n');
      },
      onPrompt: async (prompt) => {
        return input({ message: prompt.message });
      },
      onProgress: (message) => {
        console.log('  →', message);
      },
    };

    try {
      await authStorage.login('anthropic', callbacks);

      // Also add to AuthProfiles
      const creds = authStorage.getOAuthCredentials('anthropic');
      if (creds) {
        upsertAuthProfile({
          profileId: 'anthropic:default',
          credential: {
            type: 'oauth',
            provider: 'anthropic',
            ...creds,
          },
        });
      }

      return true;
    } catch (error) {
      console.error('❌ OAuth login failed:', error);
      return false;
    }
  }

  if (provider === 'minimax') {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        console.log('\n🌐 Please open this URL in your browser:\n');
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
        console.log('  →', message);
      },
    };

    try {
      const creds = await minimaxOAuthProvider.login(callbacks);
      upsertAuthProfile({
        profileId: 'minimax:default',
        credential: {
          type: 'oauth',
          provider: 'minimax',
          ...creds,
        },
      });
      return true;
    } catch (error) {
      console.error('❌ OAuth login failed:', error);
      return false;
    }
  }

  if (provider === 'minimax-cn') {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        console.log('\n🌐 请在浏览器中打开以下 URL:\n');
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
        console.log('  →', message);
      },
    };

    try {
      const creds = await minimaxCnOAuthProvider.login(callbacks);
      upsertAuthProfile({
        profileId: 'minimax-cn:default',
        credential: {
          type: 'oauth',
          provider: 'minimax-cn',
          ...creds,
        },
      });
      return true;
    } catch (error) {
      console.error('❌ OAuth 登录失败:', error);
      return false;
    }
  }

  if (provider === 'kimi') {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        console.log('\n🌐 Please open this URL in your browser:\n');
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
        console.log('  →', message);
      },
    };

    try {
      const creds = await kimiOAuthProvider.login(callbacks);
      upsertAuthProfile({
        profileId: 'kimi:default',
        credential: {
          type: 'oauth',
          provider: 'kimi',
          ...creds,
        },
      });
      return true;
    } catch (error) {
      console.error('❌ OAuth login failed:', error);
      return false;
    }
  }

  if (provider === 'github-copilot') {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        console.log('\n🌐 Please open this URL in your browser:\n');
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
        console.log('  →', message);
      },
    };

    try {
      const creds = await githubCopilotOAuthProvider.login(callbacks);
      upsertAuthProfile({
        profileId: 'github-copilot:default',
        credential: {
          type: 'oauth',
          provider: 'github-copilot',
          ...creds,
        },
      });
      return true;
    } catch (error) {
      console.error('❌ OAuth login failed:', error);
      return false;
    }
  }

  if (provider === 'google-gemini-cli') {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        console.log('\n🌐 Please open this URL in your browser:\n');
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
        console.log('  →', message);
      },
    };

    try {
      const creds = await googleGeminiCliOAuthProvider.login(callbacks);
      upsertAuthProfile({
        profileId: 'google-gemini-cli:default',
        credential: {
          type: 'oauth',
          provider: 'google-gemini-cli',
          ...creds,
        },
      });
      return true;
    } catch (error) {
      console.error('❌ OAuth login failed:', error);
      return false;
    }
  }

  if (provider === 'google-antigravity') {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        console.log('\n🌐 Please open this URL in your browser:\n');
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
        console.log('  →', message);
      },
    };

    try {
      const creds = await googleAntigravityOAuthProvider.login(callbacks);
      upsertAuthProfile({
        profileId: 'google-antigravity:default',
        credential: {
          type: 'oauth',
          provider: 'google-antigravity',
          ...creds,
        },
      });
      return true;
    } catch (error) {
      console.error('❌ OAuth login failed:', error);
      return false;
    }
  }

  if (provider === 'openai-codex') {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        console.log('\n🌐 Please open this URL in your browser:\n');
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
        console.log('  →', message);
      },
    };

    try {
      const creds = await openaiCodexOAuthProvider.login(callbacks);
      upsertAuthProfile({
        profileId: 'openai-codex:default',
        credential: {
          type: 'oauth',
          provider: 'openai-codex',
          ...creds,
        },
      });
      return true;
    } catch (error) {
      console.error('❌ OAuth login failed:', error);
      return false;
    }
  }

  console.error(`OAuth not supported for provider: ${provider}`);
  return false;
}

async function setupModel(
  existingConfig: Config | null,
  ctx: CLIContext
): Promise<Config> {
  console.log('\n🤖 Step: AI Model\n');

  const config = existingConfig || ({} as Config);
  const currentModelConfig = config?.agents?.defaults?.model;
  const currentModel =
    typeof currentModelConfig === 'string' ? currentModelConfig : currentModelConfig?.primary;

  if (currentModel) {
    console.log('Current model:', currentModel);
    const keepCurrent = await confirm({
      message: 'Keep using this model?',
      default: true,
    });
    if (keepCurrent) {
      console.log('✅ Keeping:', currentModel);
      return config;
    }
  }

  // Get sorted providers with metadata
  const sortedProviders = getSortedProviders();

  const choices = sortedProviders.map((p) => ({
    value: p,
    name: getProviderDisplayName(p),
  }));

  const provider = await select({
    message: 'Select provider:',
    choices,
  });

  const providerName = getProviderDisplayName(provider);

  // Check if provider has existing profiles
  const existingProfiles = listProfilesForProvider(provider);
  if (existingProfiles.length > 0) {
    console.log(`\n${colors.green('✓')} Found existing credentials for ${providerName}`);
    const useExisting = await confirm({
      message: 'Use existing credentials?',
      default: true,
    });

    if (useExisting) {
      // Get available models
      const modelChoices = await getModelsForProvider(provider);
      if (modelChoices.length === 0) {
        console.log(`\n⚠️  No models found for ${providerName}. Please check your credentials.`);
      } else {
        const model = await select({
          message: 'Select model:',
          choices: modelChoices,
        });

        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {
          workspace: ctx.workspacePath,
          model: { primary: model, fallbacks: [] },
          maxTokens: 8192,
          temperature: 0.7,
          maxToolIterations: 20,
          maxRequestsPerTurn: 50,
          maxToolFailuresPerTurn: 3,
        };
        config.agents.defaults.model = { primary: model, fallbacks: [] };
        config.agents.defaults.workspace = ctx.workspacePath;

        console.log('\n✅ Model configured:', model);
        return config;
      }
    }
  }

  let apiKey: string | undefined;
  let useOAuth = false;

  // Check environment variable
  const envKey = provider.toUpperCase().replace(/-/g, '_') + '_API_KEY';
  apiKey = process.env[envKey];
  if (apiKey) {
    console.log(`\n${colors.green('✓')} Found ${envKey} in environment`);
  }

  if (!apiKey) {
    // Check auth support from metadata
    const supportsOAuth = providerSupportsOAuth(provider);
    const supportsApiKey = providerSupportsApiKey(provider);
    const isOAuthOnly = supportsOAuth && !supportsApiKey;

    if (isOAuthOnly) {
      // OAuth only - no choice
      const success = await doOAuthLogin(provider);
      if (success) {
        useOAuth = true;
        console.log('\n✅ OAuth login successful!');
      } else {
        console.error('\n❌ OAuth login failed. This provider requires OAuth.');
        return config;
      }
    } else if (supportsOAuth && supportsApiKey) {
      // Dual auth - let user choose
      const authMethod = await select({
        message: `How would you like to authenticate with ${providerName}?`,
        choices: [
          { value: 'api_key', name: 'API Key (enter manually)' },
          { value: 'oauth', name: 'OAuth Login (browser-based)' },
        ],
      });

      if (authMethod === 'oauth') {
        const success = await doOAuthLogin(provider);
        if (success) {
          useOAuth = true;
          console.log('\n✅ OAuth login successful!');
        } else {
          console.log('\n⚠️ OAuth login failed. Please enter API key manually.');
          apiKey = await input({
            message: `API Key for ${providerName}:`,
            validate: (v: string) => v.length > 0 || 'Required',
          });
          useOAuth = false;
        }
      } else {
        apiKey = await input({
          message: `API Key for ${providerName}:`,
          validate: (v: string) => v.length > 0 || 'Required',
        });
      }
    } else {
      // API key only
      apiKey = await input({
        message: `API Key for ${providerName}:`,
        validate: (v: string) => v.length > 0 || 'Required',
      });
    }
  }

  // Get available models
  const modelChoices = await getModelsForProvider(provider);
  if (modelChoices.length === 0) {
    console.log(`\n⚠️  No built-in models found for ${providerName}.`);
    console.log('   You can still use custom model names.');
    const model = await input({
      message: 'Model name:',
      validate: (v: string) => v.length > 0 || 'Required',
    });

    // Store API key in new simplified format
    config.providers = config.providers || {};
    config.providers[provider] = apiKey;
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {
      workspace: ctx.workspacePath,
      model: { primary: `${provider}/${model}`, fallbacks: [] },
      maxTokens: 8192,
      temperature: 0.7,
      maxToolIterations: 20,
      maxRequestsPerTurn: 50,
      maxToolFailuresPerTurn: 3,
    };
    config.agents.defaults.model = { primary: `${provider}/${model}`, fallbacks: [] };
    config.agents.defaults.workspace = ctx.workspacePath;

    console.log('\n✅ Model configured:', `${provider}/${model}`);
    return config;
  }

  console.log(`\n📋 Available models for ${providerName}:`);
  const model = await select({
    message: 'Select model:',
    choices: modelChoices,
  });

  // Store in new simplified format
  config.providers = config.providers || {};
  if (!useOAuth && apiKey) {
    config.providers[provider] = apiKey;
  }

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {
    workspace: ctx.workspacePath,
    model: { primary: model, fallbacks: [] },
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
    maxRequestsPerTurn: 50,
    maxToolFailuresPerTurn: 3,
  };
  config.agents.defaults.model = { primary: model, fallbacks: [] };
  config.agents.defaults.workspace = ctx.workspacePath;

  console.log('\n✅ Model configured:', model);
  return config;
}

async function getModelsForProvider(provider: string): Promise<{ value: string; name: string }[]> {
  const models = getModelsByProvider(provider);
  return models.map((m) => ({
    value: `${m.provider}/${m.id}`,
    name: m.name || m.id,
  }));
}

async function setupChannels(config: Config): Promise<Config> {
  console.log('\n💬 Step: Channels (Optional)\n');

  const enableTelegram = await confirm({
    message: 'Enable Telegram?',
    default: config?.channels?.telegram?.enabled || false,
  });

  if (enableTelegram) {
    const token = await input({
      message: 'Telegram Bot Token:',
      validate: (v: string) => v.length > 0 || 'Required',
    });

    config.channels = config.channels || {};
    // Merge with existing config to preserve apiRoot and other settings
    const existingTelegram = config.channels.telegram || {};
    config.channels.telegram = {
      ...existingTelegram,
      enabled: true,
      token,
      allowFrom: ((existingTelegram as { allowFrom?: (string | number)[] }).allowFrom ?? []) as (string | number)[],
      groupAllowFrom: ((existingTelegram as { groupAllowFrom?: (string | number)[] }).groupAllowFrom ?? []) as (string | number)[],
      debug: (existingTelegram as { debug?: boolean }).debug ?? false,
      dmPolicy: ((existingTelegram as { dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled' }).dmPolicy ?? 'pairing') as 'pairing' | 'allowlist' | 'open' | 'disabled',
      groupPolicy: ((existingTelegram as { groupPolicy?: 'allowlist' | 'open' | 'disabled' }).groupPolicy ?? 'open') as 'allowlist' | 'open' | 'disabled',
      replyToMode: ((existingTelegram as { replyToMode?: 'off' | 'first' | 'all' }).replyToMode ?? 'off') as 'off' | 'first' | 'all',
      historyLimit: ((existingTelegram as { historyLimit?: number }).historyLimit ?? 50),
      textChunkLimit: ((existingTelegram as { textChunkLimit?: number }).textChunkLimit ?? 4000),
    };

    console.log('✅ Telegram enabled');
  }

  const hasTelegram = config?.channels?.telegram?.enabled;
  if (hasTelegram) {
    console.log('✅ Telegram already configured');
  }

  return config;
}

async function setupGateway(config: Config): Promise<Config> {
  console.log('\n🌐 Step: Gateway WebUI (Optional)\n');

  const enableGateway = await confirm({
    message: 'Enable Gateway WebUI?',
    default: true,
  });

  if (!enableGateway) {
    config.gateway = config.gateway || {};
    config.gateway.auth = { mode: 'none' };
    console.log('ℹ️  Gateway disabled (auth mode set to none)');
    return config;
  }

  // Check if gateway auth is already configured
  const existingToken = config?.gateway?.auth?.token;
  const existingMode = config?.gateway?.auth?.mode;

  if (existingToken && existingMode === 'token') {
    console.log('\nℹ️  Gateway auth token already configured');
    const keepExisting = await confirm({
      message: 'Keep existing token?',
      default: true,
    });

    if (keepExisting) {
      console.log('✅ Keeping existing gateway configuration');
      return config;
    }
  }

  // Generate new token
  const crypto = await import('crypto');
  const token = crypto.randomBytes(24).toString('hex');

  // Configure gateway with defaults
  config.gateway = config.gateway || {};
  config.gateway.host = config.gateway.host || '0.0.0.0';
  config.gateway.port = config.gateway.port || 18790;
  config.gateway.auth = {
    mode: 'token',
    token,
  };

  console.log('\n✅ Gateway configured:');
  console.log(`   Host: ${config.gateway.host}`);
  console.log(`   Port: ${config.gateway.port}`);
  console.log(`   Auth: Token-based (auto-generated)`);
  console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-8)}`);

  return config;
}

register({
  id: 'onboard',
  name: 'onboard',
  description: 'Interactive setup wizard for xopcbot',
  factory: createOnboardCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopcbot onboard',
      'xopcbot onboard --model',
      'xopcbot onboard --channels',
      'xopcbot onboard --gateway',
    ],
  },
});
