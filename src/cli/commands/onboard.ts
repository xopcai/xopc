import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { input, password, select, confirm } from '@inquirer/prompts';
import { loadConfig, saveConfig, ConfigSchema, PROVIDER_NAMES, listBuiltinModels, BUILTIN_MODELS, isProviderConfigured } from '../../config/index.js';

const PROVIDER_OPTIONS = [
  { name: 'OpenAI (GPT-4, o1)', value: 'openai', envKey: 'OPENAI_API_KEY', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-5', 'o1', 'o3'] },
  { name: 'Anthropic (Claude)', value: 'anthropic', envKey: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'] },
  { name: 'Google (Gemini)', value: 'google', envKey: 'GOOGLE_API_KEY', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { name: 'Qwen (通义千问)', value: 'qwen', envKey: 'QWEN_API_KEY', models: ['qwen-plus', 'qwen-max', 'qwen3-235b-a22b'] },
  { name: 'Kimi (月之暗面)', value: 'kimi', envKey: 'KIMI_API_KEY', models: ['kimi-k2.5', 'kimi-k2-thinking'] },
  { name: 'MiniMax', value: 'minimax', envKey: 'MINIMAX_API_KEY', models: ['minimax-m2.1', 'minimax-m2'] },
  { name: 'DeepSeek', value: 'deepseek', envKey: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'Groq', value: 'groq', envKey: 'GROQ_API_KEY', models: ['llama-3.3-70b-versatile'] },
];

export function createOnboardCommand(): Command {
  const cmd = new Command('onboard')
    .description('Initialize xopcbot with interactive configuration')
    .addHelpText(
      'after',
      `
Examples:
  $ xopcbot onboard                 # Full interactive setup
  $ xopcbot onboard --model-only   # Configure model only
  $ xopcbot onboard --skip-env     # Skip env var check
`
    )
    .option('--model-only', 'Configure model only')
    .option('--skip-env', 'Skip environment variable check')
    .action(async (options) => {
      console.log('🧙 xopcbot Setup Wizard\n');
      console.log('═'.repeat(50));

      const workspacePath = join(homedir(), '.xopcbot', 'workspace');
      const configPath = join(homedir(), '.xopcbot', 'config.json');

      // Step 1: Workspace setup
      if (!options.modelOnly) {
        console.log('\n📁 Step 1: Workspace\n');
        
        if (!existsSync(workspacePath)) {
          mkdirSync(workspacePath, { recursive: true });
          console.log('✅ Created workspace:', workspacePath);
        } else {
          console.log('ℹ️  Workspace already exists:', workspacePath);
        }

        createBootstrapFiles(workspacePath);
      }

      // Step 2: Model configuration
      console.log('\n🤖 Step 2: Choose Your Model\n');

      // Check existing config
      const existingConfig = existsSync(configPath) ? loadConfig(configPath) : null;
      const currentModel = existingConfig?.agents?.defaults?.model;
      
      if (currentModel) {
        console.log('Current model:', currentModel);
        const useCurrent = await confirm({
          message: 'Keep using this model?',
          default: true,
        });
        
        if (useCurrent) {
          console.log('✅ Keeping current model:', currentModel);
        } else {
          await configureModel(configPath, existingConfig);
        }
      } else {
        await configureModel(configPath, existingConfig);
      }

      // Step 3: API Key status
      if (!options.skipEnv && !options.modelOnly) {
        console.log('\n🔑 Step 3: API Key Status\n');
        
        let hasKey = false;
        const allProviders = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 
          'QWEN_API_KEY', 'KIMI_API_KEY', 'MINIMAX_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY'];
        
        for (const key of allProviders) {
          if (process.env[key]) {
            console.log(`✅ ${key} is set`);
            hasKey = true;
          }
        }
        
        if (!hasKey) {
          console.log('\n⚠️  No API keys found in environment.');
          console.log('You can set them before running:');
          console.log('  export OPENAI_API_KEY="sk-..."');
          console.log('  export QWEN_API_KEY="sk-..."');
          console.log('\nOr add them to config.json:');
          console.log('  "providers": { "qwen": { "api_key": "sk-..." } }');
        }
      }

      console.log('\n' + '═'.repeat(50));
      console.log('\n🎉 Setup Complete!\n');
      
      console.log('📝 Usage:');
      console.log('  xopcbot agent -m "Hello"           # Quick chat');
      console.log('  xopcbot agent -i                    # Interactive mode');
      console.log('  xopcbot models list                 # List models');
      
      console.log('\n🔧 Configuration:');
      console.log('  Config:', configPath);
      console.log('  Workspace:', workspacePath);
    });

  return cmd;
}

async function configureModel(configPath: string, existingConfig: any): Promise<void> {
  // Check for existing API keys in environment
  const envProviderMap: Record<string, string> = {
    'OPENAI_API_KEY': 'openai',
    'ANTHROPIC_API_KEY': 'anthropic',
    'GOOGLE_API_KEY': 'google',
    'QWEN_API_KEY': 'qwen',
    'KIMI_API_KEY': 'kimi',
    'MINIMAX_API_KEY': 'minimax',
    'DEEPSEEK_API_KEY': 'deepseek',
    'GROQ_API_KEY': 'groq',
  };

  let detectedProvider: string | null = null;
  for (const [envKey, provider] of Object.entries(envProviderMap)) {
    if (process.env[envKey]) {
      detectedProvider = provider;
      break;
    }
  }

  // Step 2.1: Select provider
  let provider: string;
  
  if (detectedProvider) {
    console.log(`\n🔍 Detected ${envProviderMap[Object.keys(envProviderMap).find(k => envProviderMap[k] === detectedProvider)!]} API key in environment`);
    const useDetected = await confirm({
      message: `Use ${detectedProvider}?`,
      default: true,
    });
    provider = useDetected ? detectedProvider : await selectProvider();
  } else {
    provider = await selectProvider();
  }

  // Step 2.2: Enter API key if not in env
  const providerInfo = PROVIDER_OPTIONS.find(p => p.value === provider)!;
  let apiKey = process.env[`${providerInfo.envKey}`];
  
  if (!apiKey) {
    console.log(`\n🔑 Enter API key for ${providerInfo.name}`);
    apiKey = await password({
      message: `API Key for ${providerInfo.name}:`,
      validate: (value: string) => value.length > 0 || 'API key is required',
    });
  } else {
    console.log(`✅ API key found in ${providerInfo.envKey}`);
  }

  // Step 2.3: Select model
  console.log(`\n📋 Available models for ${providerInfo.name}:`);
  const model = await select({
    message: 'Select a model:',
    choices: providerInfo.models.map(m => ({
      value: `${provider}/${m}`,
      name: m,
    })),
  });

  // Step 2.4: Save config
  const config = existingConfig ? { ...existingConfig } : {};
  
  // Ensure providers object exists
  if (!config.providers) {
    config.providers = {};
  }
  
  // Save API key to config (or keep empty if in env)
  if (apiKey) {
    config.providers[provider] = {
      api_key: apiKey,
    };
  }

  // Set default model
  config.agents = {
    defaults: {
      model,
    },
  };

  // Create default workspace
  config.agents.defaults.workspace = join(homedir(), '.xopcbot', 'workspace');

  saveConfig(config, configPath);
  console.log('\n✅ Configuration saved!');
  console.log(`   Model: ${model}`);
  console.log(`   Provider: ${provider}`);
}

async function selectProvider(): Promise<string> {
  const choices = PROVIDER_OPTIONS.map(p => ({
    value: p.value,
    name: `${p.name} (${p.envKey})`,
  }));
  
  return await select({
    message: 'Select a model provider:',
    choices,
  });
}

function createBootstrapFiles(workspace: string): void {
  const files: Record<string, string> = {
    'AGENTS.md': `# Agent Instructions

You are xopcbot, a helpful AI assistant.

## Guidelines

- Be concise and helpful
- Use tools when appropriate
- Ask for clarification when needed
`,
    'SOUL.md': `# Soul

I am xopcbot, a lightweight AI assistant.

## Personality

- Helpful and friendly
- Concise and to the point
`,
    'USER.md': `# User

*Learn about the person you're helping.*

## Notes

*(Update as you learn more about the user)*
`,
    'TOOLS.md': `# Tools

*Local notes for your setup.*

## What Goes Here

- SSH hosts
- Device nicknames
- Preferred settings
`,
  };

  const memoryDir = join(workspace, 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  for (const [filename, content] of Object.entries(files)) {
    const path = join(workspace, filename);
    if (!existsSync(path)) {
      writeFileSync(path, content, 'utf-8');
      console.log('✅ Created', filename);
    }
  }
}
