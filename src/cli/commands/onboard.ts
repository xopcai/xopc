import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { input, select, confirm } from '@inquirer/prompts';
import { saveConfig, PROVIDER_OPTIONS } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import { loadAllTemplates } from '../templates.js';
import type { CLIContext } from '../registry.js';
import { AuthStorage, anthropicOAuthProvider, type OAuthLoginCallbacks } from '../../auth/index.js';
import { homedir } from 'os';

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

async function setupNonInteractive(configPath: string, existingConfig: any): Promise<any> {
  console.log('\n🤖 Step 2: AI Model (Non-Interactive Mode)\n');
  console.log('Current config:', JSON.stringify(existingConfig?.agents?.defaults?.model, null, 2));
  console.log('\n💡 To configure in interactive mode, run: xopcbot onboard');
  console.log('💡 Or set up manually in:', configPath);
  return existingConfig;
}

function createOnboardCommand(ctx: CLIContext): Command {
  const cmd = new Command('onboard')
    .description('Interactive setup wizard for xopcbot')
    .addHelpText('after', formatExamples([
      'xopcbot onboard              # Full interactive setup',
      'xopcbot onboard --quick       # Quick model setup only',
    ]))
    .option('--quick', 'Quick setup (model only)')
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

async function runOnboard(options: { quick?: boolean }, ctx: CLIContext): Promise<void> {
  console.log('🧙 xopcbot Setup Wizard\n');
  console.log('═'.repeat(50));

  const workspacePath = ctx.workspacePath;
  const configPath = ctx.configPath;

  // Use raw config loading to avoid schema defaults being added
  const existingConfig = loadRawConfig(configPath);

  if (!options.quick) {
    await setupWorkspace(workspacePath, isInteractive());
  }

  if (!isInteractive()) {
    const updatedConfig = await setupNonInteractive(configPath, existingConfig);
    if (!options.quick) {
      await setupChannels(configPath, updatedConfig);
    }
    console.log('\n' + '═'.repeat(50));
    console.log('\n🎉 Setup Complete!\n');
    return;
  }

  const updatedConfig = await setupModel(configPath, existingConfig, ctx);

  if (!options.quick) {
    await setupChannels(configPath, updatedConfig);
  }

  console.log('\n' + '═'.repeat(50));
  console.log('\n🎉 Setup Complete!\n');

  if (!options.quick) {
    console.log('🚀 Next Steps:');
    console.log('  1. Read BOOTSTRAP.md in your workspace for first-run guidance');
    console.log('  2. Chat with your assistant: xopcbot agent -i');
    console.log('');
  }

  console.log('📝 Usage:');
  console.log('  xopcbot agent -m "Hello"    # Chat with AI');
  console.log('  xopcbot agent -i            # Interactive mode');
  console.log('  xopcbot models list         # List models');

  console.log('\n📁 Files:');
  console.log('  Config:', configPath);
  console.log('  Workspace:', workspacePath);
  if (!options.quick) {
    console.log('  Bootstrap:', join(workspacePath, 'BOOTSTRAP.md'));
  }
}

async function doOAuthLogin(provider: string): Promise<string> {
  console.log('\n🔐 Starting OAuth login...');
  
  // Create AuthStorage and register OAuth providers
  const authPath = join(homedir(), '.xopcbot', 'auth.json');
  const authStorage = new AuthStorage({ filename: authPath });
  
  if (provider === 'anthropic') {
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
      return 'oauth'; // Return a marker to indicate OAuth was used
    } catch (error) {
      console.error('❌ OAuth login failed:', error);
      throw new Error('OAuth login was cancelled or failed');
    }
  }
  
  throw new Error(`OAuth not supported for provider: ${provider}`);
}

async function setupWorkspace(workspacePath: string, interactive: boolean): Promise<void> {
  console.log('\n📁 Step 1: Workspace\n');

  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
    console.log('✅ Created workspace:', workspacePath);
  } else {
    console.log('ℹ️  Workspace already exists:', workspacePath);
  }

  createBootstrapFiles(workspacePath, interactive);
}

async function setupModel(configPath: string, existingConfig: any, ctx: CLIContext): Promise<any> {
  console.log('\n🤖 Step 2: AI Model\n');

  const currentModelConfig = existingConfig?.agents?.defaults?.model;
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
      return existingConfig;
    }
  }

  const provider = await select({
    message: 'Select provider:',
    choices: PROVIDER_OPTIONS.map(p => ({
      value: p.value,
      name: `${p.name} (${p.envKey})`,
    })),
  });

  const providerInfo = PROVIDER_OPTIONS.find(p => p.value === provider)!;
  
  // Check if provider supports OAuth
  const oauthProviders = ['anthropic']; // Add more providers as needed
  const supportsOAuth = oauthProviders.includes(provider);
  
  let apiKey = process.env[`${providerInfo.envKey}`];
  let useOAuth = false;

  if (!apiKey) {
    if (supportsOAuth) {
      // Ask user to choose between API Key and OAuth
      const authMethod = await select({
        message: `How would you like to authenticate with ${providerInfo.name}?`,
        choices: [
          { value: 'api_key', name: 'API Key (enter manually)' },
          { value: 'oauth', name: 'OAuth Login (browser-based)' },
        ],
      });
      
      if (authMethod === 'oauth') {
        useOAuth = true;
        apiKey = await doOAuthLogin(provider);
      } else {
        console.log(`\n🔑 Enter API key for ${providerInfo.name}`);
        apiKey = await input({
          message: `API Key:`,
          validate: (v: string) => v.length > 0 || 'Required',
        });
      }
    } else {
      console.log(`\n🔑 Enter API key for ${providerInfo.name}`);
      apiKey = await input({
        message: `API Key:`,
        validate: (v: string) => v.length > 0 || 'Required',
      });
    }
  } else {
    console.log(`✅ Found ${providerInfo.envKey} in environment`);
  }

  console.log(`\n📋 Available models:`);
  const model = await select({
    message: 'Select model:',
    choices: providerInfo.models.map(m => ({
      value: `${provider}/${m}`,
      name: m,
    })),
  });

  const config = existingConfig || {};
  config.providers = config.providers || {};
  
  if (useOAuth) {
    // For OAuth, we don't store the API key in config.json
    // It's stored in auth.json via AuthStorage
    config.providers[provider] = {};
    console.log('\n✅ OAuth login successful! Credentials saved to ~/.xopcbot/auth.json');
  } else {
    config.providers[provider] = { apiKey };
  }

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = { primary: model, fallbacks: [] };
  config.agents.defaults.workspace = ctx.workspacePath;

  saveConfig(config, configPath);
  console.log('\n✅ Model configured:', model);
  return config;
}

async function setupChannels(configPath: string, config: any): Promise<void> {
  if (!isInteractive()) {
    console.log('\n💬 Step 3: Channels (Optional)\n');
    console.log('💡 To configure channels, edit the config file manually.');
    return;
  }

  console.log('\n💬 Step 3: Channels (Optional)\n');

  const enableTelegram = await confirm({
    message: 'Enable Telegram?',
    default: false,
  });

  if (enableTelegram) {
    const token = await input({
      message: 'Telegram Bot Token:',
      validate: (v: string) => v.length > 0 || 'Required',
    });

    config.channels = config.channels || {};
    config.channels.telegram = { enabled: true, token, allowFrom: [] };

    saveConfig(config, configPath);
    console.log('✅ Telegram enabled');
  }

  const hasTelegram = config?.channels?.telegram?.enabled;
  if (hasTelegram) {
    console.log('✅ Telegram already configured');
  }
}

function createBootstrapFiles(workspace: string, interactive: boolean): void {
  // Load templates from docs/reference/templates/
  const templates = loadAllTemplates();

  const memoryDir = join(workspace, 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log('✅ Created memory/ directory');
  }

  for (const [filename, content] of Object.entries(templates)) {
    const filePath = join(workspace, filename);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf-8');
      console.log('✅ Created', filename);
    } else if (interactive) {
      console.log('ℹ️ ', filename, 'already exists (skipped)');
    }
  }
}

register({
  id: 'onboard',
  name: 'onboard',
  description: 'Interactive setup wizard for xopcbot',
  factory: createOnboardCommand,
  metadata: { category: 'setup', examples: [
    'xopcbot onboard',
    'xopcbot onboard --quick',
  ]},
});
