import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { password, select, confirm } from '@inquirer/prompts';
import { loadConfig, saveConfig, PROVIDER_OPTIONS } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import type { CLIContext } from '../registry.js';

function createOnboardCommand(_ctx: CLIContext): Command {
  const cmd = new Command('onboard')
    .description('Interactive setup wizard for xopcbot')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot onboard              # Full interactive setup',
        'xopcbot onboard --quick       # Quick model setup only',
      ])
    )
    .option('--quick', 'Quick setup (model only)')
    .action(async (options) => {
      console.log('🧙 xopcbot Setup Wizard\n');
      console.log('═'.repeat(50));

      const workspacePath = join(homedir(), '.xopcbot', 'workspace');
      const configPath = join(homedir(), '.xopcbot', 'config.json');

      const existingConfig = existsSync(configPath) ? loadConfig(configPath) : null;

      if (!options.quick) {
        await setupWorkspace(workspacePath);
      }

      const updatedConfig = await setupModel(configPath, existingConfig);

      if (!options.quick) {
        await setupChannels(configPath, updatedConfig);
      }

      console.log('\n' + '═'.repeat(50));
      console.log('\n🎉 Setup Complete!\n');

      console.log('📝 Usage:');
      console.log('  xopcbot agent -m "Hello"    # Chat with AI');
      console.log('  xopcbot models list         # List models');

      console.log('\n📁 Files:');
      console.log('  Config:', configPath);
      console.log('  Workspace:', workspacePath);
    });

  return cmd;
}

async function setupWorkspace(workspacePath: string): Promise<void> {
  console.log('\n📁 Step 1: Workspace\n');

  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
    console.log('✅ Created workspace:', workspacePath);
  } else {
    console.log('ℹ️  Workspace already exists:', workspacePath);
  }

  createBootstrapFiles(workspacePath);
}

async function setupModel(configPath: string, existingConfig: any): Promise<any> {
  console.log('\n🤖 Step 2: AI Model\n');

  const currentModel = existingConfig?.agents?.defaults?.model;
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
  let apiKey = process.env[`${providerInfo.envKey}`];

  if (!apiKey) {
    console.log(`\n🔑 Enter API key for ${providerInfo.name}`);
    apiKey = await password({
      message: `API Key:`,
      validate: (v: string) => v.length > 0 || 'Required',
    });
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
  config.providers[provider] = { apiKey };
  config.agents = {
    defaults: {
      model,
      workspace: join(homedir(), '.xopcbot', 'workspace'),
    },
  };

  saveConfig(config, configPath);
  console.log('\n✅ Model configured:', model);
  return config;
}

async function setupChannels(configPath: string, config: any): Promise<void> {
  console.log('\n💬 Step 3: Channels (Optional)\n');

  const enableTelegram = await confirm({
    message: 'Enable Telegram?',
    default: false,
  });

  if (enableTelegram) {
    const token = await password({
      message: 'Telegram Bot Token:',
      validate: (v: string) => v.length > 0 || 'Required',
    });

    config.channels = config.channels || {};
    config.channels.telegram = {
      enabled: true,
      token,
      allowFrom: [],
    };

    saveConfig(config, configPath);
    console.log('✅ Telegram enabled');
  }

  const hasTelegram = config?.channels?.telegram?.enabled;
  if (hasTelegram) {
    console.log('✅ Telegram already configured');
  }
}

function createBootstrapFiles(workspace: string): void {
  const files: Record<string, string> = {
    'AGENTS.md': `# Agent Instructions

You are xopcbot, a helpful AI assistant.

## Guidelines

- Be concise and helpful
- Use tools when appropriate
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

*(Update as you learn more)*
`,
    'TOOLS.md': `# Tools

*Local notes for your setup.*

## What Goes Here

- SSH hosts
- Device nicknames
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

register({
  id: 'onboard',
  name: 'onboard',
  description: 'Interactive setup wizard for xopcbot',
  factory: createOnboardCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopcbot onboard',
      'xopcbot onboard --quick',
    ],
  },
});
