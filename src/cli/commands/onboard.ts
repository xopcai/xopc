import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { input, select, confirm } from '@inquirer/prompts';
import { saveConfig } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import { getFallbackTemplate, TEMPLATE_FILES } from '../templates.js';
import type { CLIContext } from '../registry.js';
import { AuthStorage, anthropicOAuthProvider, minimaxOAuthProvider, minimaxCnOAuthProvider, kimiOAuthProvider, githubCopilotOAuthProvider, googleGeminiCliOAuthProvider, googleAntigravityOAuthProvider, openaiCodexOAuthProvider, type OAuthLoginCallbacks } from '../../auth/index.js';
import { upsertAuthProfile, listProfilesForProvider } from '../../auth/profiles/index.js';
import { 
  getAllProviders, 
  getModelsByProvider, 
  resolveModel, 
  PROVIDER_META, 
  getSortedProviders,
  getProviderDisplayName,
  providerSupportsOAuth,
  providerSupportsApiKey,
} from '../../providers/index.js';
import { colors } from '../utils/colors.js';
import { homedir } from 'os';
import { GatewayProcessManager } from '../../gateway/process-manager.js';
import type { GatewayProcessConfig } from '../../gateway/process-manager.types.js';

/**
 * Load raw config without schema parsing to avoid default values being added.
 * This preserves the user's original config structure during onboard.
 */
function loadRawConfig(configPath: string): any {
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
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

async function setupNonInteractive(_configPath: string, existingConfig: any): Promise<any> {
  console.log('\n🤖 AI Model Configuration (Non-Interactive Mode)\n');
  console.log('Current config:', JSON.stringify(existingConfig?.agents?.defaults?.model, null, 2));
  console.log('\n💡 To configure in interactive mode, run: xopcbot onboard');
  console.log('💡 Or set up manually in:', _configPath);
  return existingConfig;
}

function createOnboardCommand(ctx: CLIContext): Command {
  const cmd = new Command('onboard')
    .description('Interactive setup wizard for xopcbot')
    .addHelpText('after', formatExamples([
      'xopcbot onboard              # Full interactive setup',
      'xopcbot onboard --model      # Configure LLM model only',
      'xopcbot onboard --channels   # Configure channels only',
      'xopcbot onboard --gateway   # Configure gateway only',
    ]))
    .option('--model', 'Configure LLM provider and model')
    .option('--channels', 'Configure messaging channels')
    .option('--gateway', 'Configure gateway WebUI')
    .option('--all', 'Configure everything (default)')
    .action(async (options) => {
      try {
        await runOnboard(options, ctx);
      } catch (error: any) {
        // Handle user cancellation gracefully (Ctrl+C)
        if (error?.name === 'ExitPromptError' || error?.code === 'EXIT_PROMPT') {
          console.log('\n\n👋 Setup cancelled.');
          process.exit(0);
        }
        throw error;
      }
    });

  return cmd;
}

async function runOnboard(options: { model?: boolean; channels?: boolean; gateway?: boolean; all?: boolean }, ctx: CLIContext): Promise<void> {
  console.log('🧙 xopcbot Setup Wizard\n');
  console.log('═'.repeat(50));

  const workspacePath = ctx.workspacePath;
  const configPath = ctx.configPath;

  // Use raw config loading to avoid schema defaults being added
  let config = loadRawConfig(configPath) || {};

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
  await saveConfig(config, configPath);

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
    console.log(`  Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
    console.log('');
    console.log('  Direct Access URL (with token):');
    console.log(`    ${webuiUrl}`);
    console.log('');

    // Auto-start gateway after onboarding
    await startGatewayNow(config, ctx);
  }
}

/**
 * Print gateway access info and management commands
 */
function printGatewayInfo(host: string, port: number, pid?: number): void {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;

  if (pid) {
    console.log(`   PID: ${pid}`);
  }
  console.log('');
  console.log('🌐 WebUI is available at:');
  console.log(`   http://${displayHost}:${port}`);
  console.log('');
  console.log('📝 Management Commands:');
  console.log('   xopcbot gateway status    # Check status');
  console.log('   xopcbot gateway stop      # Stop gateway');
  console.log('   xopcbot gateway restart   # Restart gateway');
  console.log('   xopcbot gateway logs      # View logs');
}

/**
 * Handle start/restart errors
 */
async function handleGatewayError(
  error: unknown,
  port: number,
  isRestart: boolean
): Promise<void> {
  const action = isRestart ? 'restart' : 'start';
  console.error(`❌ Failed to ${action} gateway`);
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`   ${errorMsg}`);

  if (isRestart) {
    const { getProcessUsingPort } = await import('../../gateway/port-checker.js');
    const pid = await getProcessUsingPort(port);
    if (pid) {
      console.error(`\n💡 Port ${port} is used by PID ${pid}`);
      console.error(`💡 To stop: kill ${pid} or kill -9 ${pid}`);
    }
  }
}

/**
 * Handle start result errors
 */
function handleStartResultError(result: { error?: string }): void {
  // Check if it's a "compiled code not found" error
  const isDevMode = result.error?.includes('Compiled code not found');

  console.error('❌ Failed to start gateway in background mode');

  if (isDevMode) {
    console.log('');
    console.log('⚠️  You are in development mode (using tsx).');
    console.log('');
    console.log('💡 Option 1: Build and run in background (recommended)');
    console.log('    pnpm run build');
    console.log('    xopcbot gateway --background');
    console.log('');
    console.log('💡 Option 2: Run in foreground (blocks terminal)');
    console.log('    xopcbot gateway');
    console.log('    # Press Ctrl+C to stop');
    console.log('');
  } else if (result.error) {
    console.error(`   ${result.error}`);
  }
}

/**
 * Check if running in development mode (using tsx)
 */
function isDevMode(): boolean {
  return process.argv.some(arg => arg.includes('tsx')) ||
         process.execArgv.some(arg => arg.includes('tsx'));
}

/**
 * Start gateway process immediately after onboarding
 * If already running, restart to apply new config
 * In development mode, starts in foreground mode (no background).
 */
async function startGatewayNow(config: any, ctx: CLIContext): Promise<void> {
  const devMode = isDevMode();
  const manager = new GatewayProcessManager();
  const host = config?.gateway?.host || '0.0.0.0';
  const port = config?.gateway?.port || 18790;
  const token = config.gateway.auth.token;

  const processConfig: GatewayProcessConfig = {
    host,
    port,
    token,
    configPath: ctx.configPath,
    background: !devMode,
    enableHotReload: devMode,
  };

  // Case 1: Gateway is running with PID file - restart it
  if (manager.isRunning()) {
    console.log('\n🔄 Restarting Gateway WebUI...');
    try {
      await manager.restart(processConfig);
      console.log('✅ Gateway restarted successfully!');
      printGatewayInfo(host, port);
    } catch (error) {
      await handleGatewayError(error, port, true);
    }
    return;
  }

  // Check port availability
  const { checkPortAvailable } = await import('../../gateway/port-checker.js');
  const portAvailable = await checkPortAvailable(port);

  // Case 2: Port is in use but no PID file - try restart
  if (!portAvailable) {
    console.log('\n🔄 Gateway is already running (port in use), restarting...');
    try {
      await manager.restart(processConfig);
      console.log('✅ Gateway restarted successfully!');
      printGatewayInfo(host, port);
    } catch (error) {
      await handleGatewayError(error, port, true);
    }
    return;
  }

  // Case 3: Port is available - start new gateway
  console.log('\n🚀 Starting Gateway WebUI...');
  const result = await manager.start(processConfig);

  if (result.success) {
    console.log('✅ Gateway started successfully!');
    printGatewayInfo(host, port, result.pid);
  } else if (result.portInUse) {
    // Port conflict detected during start, try restart instead
    console.log('\n🔄 Port is in use, attempting restart...');
    try {
      await manager.restart(processConfig);
      console.log('✅ Gateway restarted successfully!');
      printGatewayInfo(host, port);
    } catch (error) {
      await handleGatewayError(error, port, true);
    }
  } else {
    handleStartResultError(result);
  }
}

async function doOAuthLogin(provider: string): Promise<boolean> {
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

async function setupModel(existingConfig: any, ctx: CLIContext): Promise<any> {
  console.log('\n🤖 Step: AI Model\n');

  const config = existingConfig || {};
  const currentModelConfig = config?.agents?.defaults?.model;
  const currentModel = typeof currentModelConfig === 'string'
    ? currentModelConfig
    : currentModelConfig?.primary;

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

  const choices = sortedProviders.map(p => ({
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
        config.agents.defaults = config.agents.defaults || {};
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
  const envKey = provider.toUpperCase() + '_API_KEY';
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
    config.agents.defaults = config.agents.defaults || {};
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
  if (!useOAuth) {
    config.providers[provider] = apiKey;
  }

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = { primary: model, fallbacks: [] };
  config.agents.defaults.workspace = ctx.workspacePath;

  console.log('\n✅ Model configured:', model);
  return config;
}

async function getModelsForProvider(provider: string): Promise<{ value: string; name: string }[]> {
  const models = getModelsByProvider(provider);
  return models.map(m => ({
    value: `${m.provider}/${m.id}`,
    name: m.name || m.id,
  }));
}

async function setupChannels(config: any): Promise<any> {
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
    config.channels.telegram = {
      ...config.channels.telegram,
      enabled: true,
      token,
      allowFrom: config.channels.telegram?.allowFrom ?? [],
      debug: config.channels.telegram?.debug ?? false,
      dmPolicy: config.channels.telegram?.dmPolicy ?? 'pairing',
      groupPolicy: config.channels.telegram?.groupPolicy ?? 'open',
    };

    console.log('✅ Telegram enabled');
  }

  const hasTelegram = config?.channels?.telegram?.enabled;
  if (hasTelegram) {
    console.log('✅ Telegram already configured');
  }

  const enableWhatsApp = await confirm({
    message: 'Enable WhatsApp?',
    default: config?.channels?.whatsapp?.enabled || false,
  });

  if (enableWhatsApp) {
    const bridgeUrl = await input({
      message: 'WhatsApp Bridge URL:',
      default: 'ws://localhost:3001',
    });

    config.channels = config.channels || {};
    config.channels.whatsapp = {
      ...config.channels.whatsapp,
      enabled: true,
      bridgeUrl,
      allowFrom: config.channels.whatsapp?.allowFrom ?? [],
    };
    console.log('✅ WhatsApp enabled');
  }

  return config;
}

async function setupGateway(config: any): Promise<any> {
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
  metadata: { category: 'setup', examples: [
    'xopcbot onboard',
    'xopcbot onboard --model',
    'xopcbot onboard --channels',
    'xopcbot onboard --gateway',
  ]},
});
