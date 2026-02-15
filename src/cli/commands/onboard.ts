import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { input, select, confirm } from '@inquirer/prompts';
import { saveConfig, PROVIDER_OPTIONS } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import { loadAllTemplates } from '../templates.js';
import type { CLIContext } from '../registry.js';
import { AuthStorage, anthropicOAuthProvider, qwenPortalOAuthProvider, type OAuthLoginCallbacks } from '../../auth/index.js';
import { upsertAuthProfile, listProfilesForProvider } from '../../auth/profiles/index.js';
import { PROVIDER_INFO, ModelRegistry } from '../../providers/index.js';
import { colors } from '../utils/colors.js';
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
  console.log('  xopcbot auth list           # View authentication');

  console.log('\n📁 Files:');
  console.log('  Config:', configPath);
  console.log('  Workspace:', workspacePath);
  if (!options.quick) {
    console.log('  Bootstrap:', join(workspacePath, 'BOOTSTRAP.md'));
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
  
  if (provider === 'qwen') {
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
      const creds = await qwenPortalOAuthProvider.login(callbacks);
      upsertAuthProfile({
        profileId: 'qwen:default',
        credential: {
          type: 'oauth',
          provider: 'qwen',
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

  // Build provider options dynamically from ModelRegistry
  const providerInfos = ModelRegistry.getAllProviderInfo();
  
  // Filter to providers that have models and are commonly used
  const commonProviders = ['openai', 'anthropic', 'google', 'qwen', 'kimi', 'deepseek', 'groq', 'moonshot', 'minimax'];
  const availableProviders = providerInfos.filter(p => commonProviders.includes(p.id));
  
  const choices = availableProviders.map(p => ({
    value: p.id,
    name: `${p.name} (${p.envKey || 'no env key'})`,
  }));

  const provider = await select({
    message: 'Select provider:',
    choices,
  });

  const providerInfo = providerInfos.find(p => p.id === provider)!;
  
  // Check if provider has existing profiles
  const existingProfiles = listProfilesForProvider(provider);
  if (existingProfiles.length > 0) {
    console.log(`\n${colors.green('✓')} Found existing credentials for ${providerInfo.name}`);
    const useExisting = await confirm({
      message: 'Use existing credentials?',
      default: true,
    });
    
    if (useExisting) {
      // Get available models
      const modelChoices = getModelsForProvider(provider);
      if (modelChoices.length === 0) {
        console.log(`\n⚠️  No models found for ${providerInfo.name}. Please check your credentials.`);
      } else {
        const model = await select({
          message: 'Select model:',
          choices: modelChoices,
        });
        
        const config = existingConfig || {};
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = { primary: model, fallbacks: [] };
        config.agents.defaults.workspace = ctx.workspacePath;
        
        saveConfig(config, configPath);
        console.log('\n✅ Model configured:', model);
        return config;
      }
    }
  }
  
  // Check if provider supports OAuth
  const supportsOAuth = providerInfo.supportsOAuth;
  
  let apiKey: string | undefined;
  let useOAuth = false;

  // Check environment variable first
  if (providerInfo.envKey) {
    apiKey = process.env[providerInfo.envKey];
    if (apiKey) {
      console.log(`\n${colors.green('✓')} Found ${providerInfo.envKey} in environment`);
    }
  }

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
        const success = await doOAuthLogin(provider);
        if (success) {
          useOAuth = true;
          console.log('\n✅ OAuth login successful!');
        } else {
          console.log('\n⚠️ OAuth login failed. Please enter API key manually.');
          apiKey = await input({
            message: `API Key for ${providerInfo.name}:`,
            validate: (v: string) => v.length > 0 || 'Required',
          });
          useOAuth = false;
        }
      } else {
        apiKey = await input({
          message: `API Key for ${providerInfo.name}:`,
          validate: (v: string) => v.length > 0 || 'Required',
        });
      }
    } else {
      apiKey = await input({
        message: `API Key for ${providerInfo.name}:`,
        validate: (v: string) => v.length > 0 || 'Required',
      });
    }
  }

  // Get available models
  const modelChoices = getModelsForProvider(provider);
  if (modelChoices.length === 0) {
    console.log(`\n⚠️  No built-in models found for ${providerInfo.name}.`);
    console.log('   You can still use custom model names.');
    const model = await input({
      message: 'Model name:',
      validate: (v: string) => v.length > 0 || 'Required',
    });
    
    const config = existingConfig || {};
    config.providers = config.providers || {};
    config.providers[provider] = { apiKey };
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.model = { primary: `${provider}/${model}`, fallbacks: [] };
    config.agents.defaults.workspace = ctx.workspacePath;
    
    saveConfig(config, configPath);
    console.log('\n✅ Model configured:', `${provider}/${model}`);
    return config;
  }

  console.log(`\n📋 Available models for ${providerInfo.name}:`);
  const model = await select({
    message: 'Select model:',
    choices: modelChoices,
  });

  const config = existingConfig || {};
  config.providers = config.providers || {};
  
  if (useOAuth) {
    // For OAuth, we don't store the API key in config.json
    // It's stored in auth-profiles.json via AuthProfiles
    config.providers[provider] = {};
    console.log('\n✅ Credentials saved to auth profiles');
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

function getModelsForProvider(provider: string): { value: string; name: string }[] {
  const { ModelRegistry } = require('../../providers/registry.js');
  const registry = new ModelRegistry();
  const models = registry.getAll().filter(m => m.provider === provider);
  
  return models.map(m => ({
    value: `${m.provider}/${m.id}`,
    name: m.name || m.id,
  }));
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
