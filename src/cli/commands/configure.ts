import { Command } from 'commander';
import { input, confirm, select, password } from '@inquirer/prompts';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, saveConfig, ConfigSchema, getApiBase } from '../../config/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

// ============================================
// Provider Options - Simplified for Quick Start
// ============================================

const PROVIDER_OPTIONS = [
  { 
    name: 'Anthropic Claude', 
    value: 'anthropic', 
    models: ['anthropic/claude-opus-4-5', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-haiku-4-5'],
    apiUrl: 'api.anthropic.com',
  },
  { 
    name: 'OpenAI GPT-4', 
    value: 'openai', 
    models: ['openai/gpt-4o', 'openai/gpt-4o-mini'],
    apiUrl: 'api.openai.com',
  },
  { 
    name: 'Google Gemini', 
    value: 'google', 
    models: ['google/gemini-2.5-pro', 'google/gemini-2.5-flash'],
    apiUrl: 'generativelanguage.googleapis.com',
  },
  { 
    name: 'DeepSeek', 
    value: 'deepseek', 
    models: ['deepseek/deepseek-chat', 'deepseek/deepseek-r1'],
    apiUrl: 'api.deepseek.com',
  },
  { 
    name: 'Qwen (通义千问)', 
    value: 'qwen', 
    models: ['qwen/qwen-plus', 'qwen/qwen3-235b-a22b'],
    apiUrl: 'dashscope.aliyuncs.com',
  },
  { 
    name: 'Kimi (月之暗面)', 
    value: 'kimi', 
    models: ['kimi/kimi-k2.5', 'kimi/kimi-k2-thinking'],
    apiUrl: 'api.moonshot.cn',
  },
  { 
    name: 'MiniMax', 
    value: 'minimax', 
    models: ['minimax/minimax-m2.1'],
    apiUrl: 'api.minimax.chat',
  },
  { 
    name: 'OpenRouter', 
    value: 'openrouter', 
    models: ['anthropic/claude-opus-4-5', 'openai/gpt-4o', 'google/gemini-2.5-pro'],
    apiUrl: 'openrouter.ai',
  },
  { 
    name: 'Groq', 
    value: 'groq', 
    models: ['groq/llama-3.3-70b-versatile', 'groq/llama-3.1-70b-instruct'],
    apiUrl: 'api.groq.com',
  },
];

function createConfigureCommand(ctx: CLIContext): Command {
  const cmd = new Command('configure')
    .description('Configure xopcbot interactively')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot configure                    # Full wizard',
        'xopcbot configure --provider         # Provider only',
        'xopcbot configure --channel          # Channels only',
      ])
    )
    .option('--provider', 'Configure LLM provider')
    .option('--channel', 'Configure channels')
    .option('--all', 'Configure everything')
    .action(async (opts) => {
      const configPath = ctx.configPath;
      const existingConfig = existsSync(configPath)
        ? loadConfig(configPath)
        : ConfigSchema.parse({});

      const doProvider = opts.provider || opts.all;
      const doChannel = opts.channel || opts.all;
      const runFullWizard = !doProvider && !doChannel;

      console.log('\n🧙 xopcbot Configuration\n');
      console.log('─'.repeat(40));

      // ========================================
      // Step 1: Provider Configuration
      // ========================================
      if (runFullWizard || doProvider) {
        console.log('\n📦 Step 1: LLM Provider\n');

        const provider = await select({
          message: 'Select your LLM provider:',
          choices: PROVIDER_OPTIONS.map(p => ({ value: p.value, name: `${p.name} (${p.apiUrl})` })),
        });

        const providerInfo = PROVIDER_OPTIONS.find(p => p.value === provider)!;
        console.log(`\n📌 ${providerInfo.name}`);

        const apiKey = await password({
          message: `Enter API key:`,
          validate: (value: string) => value.length > 0 || 'API key is required',
        });

        // Save config based on provider type
        const updatedConfig = { ...existingConfig };
        
        if (provider === 'anthropic') {
          updatedConfig.providers = {
            ...updatedConfig.providers,
            anthropic: { apiKey: apiKey },
          };
        } else if (provider === 'google') {
          updatedConfig.providers = {
            ...updatedConfig.providers,
            google: { apiKey: apiKey },
          };
        } else {
          // All OpenAI-compatible providers use openai config
          const apiBase = getApiBase({ providers: { openai: { apiKey: apiKey } } } as any, `${provider}/dummy`);
          updatedConfig.providers = {
            ...updatedConfig.providers,
            openai: { 
              apiKey: apiKey,
              ...(apiBase ? { apiBase } : {}),
            },
          };
        }

        // Select model
        const model = await select({
          message: 'Select model:',
          choices: providerInfo.models.map(m => ({ value: m, name: m })),
        });

        updatedConfig.agents = {
          ...updatedConfig.agents,
          defaults: {
            ...updatedConfig.agents?.defaults,
            model,
          },
        };

        const finalConfig = ConfigSchema.parse(updatedConfig);
        saveConfig(finalConfig, configPath);
        console.log(`\n✅ ${providerInfo.name} configured`);
      }

      // ========================================
      // Step 2: Channel Configuration
      // ========================================
      if (runFullWizard || doChannel) {
        console.log('\n💬 Step 2: Channels\n');

        const enableTelegram = await confirm({
          message: 'Enable Telegram?',
          default: existingConfig.channels?.telegram?.enabled || false,
        });

        if (enableTelegram) {
          const token = await password({ message: 'Telegram Bot Token:' });
          const allowFrom = await input({
            message: 'Allowed user IDs (comma-separated, leave empty for all):',
            default: '',
          });

          const updatedConfig = existsSync(configPath) ? loadConfig(configPath) : ConfigSchema.parse({});
          updatedConfig.channels = {
            ...updatedConfig.channels,
            telegram: {
              enabled: true,
              token,
              allowFrom: allowFrom
                ? allowFrom.split(',').map((s: string) => s.trim())
                : [],
            },
          };
          saveConfig(updatedConfig, configPath);
          console.log('\n✅ Telegram configured');
        }

        const enableWhatsApp = await confirm({
          message: 'Enable WhatsApp?',
          default: existingConfig.channels?.whatsapp?.enabled || false,
        });

        if (enableWhatsApp) {
          const bridgeUrl = await input({
            message: 'WhatsApp Bridge URL:',
            default: 'ws://localhost:3001',
          });

          const updatedConfig = existsSync(configPath) ? loadConfig(configPath) : ConfigSchema.parse({});
          updatedConfig.channels = {
            ...updatedConfig.channels,
            whatsapp: {
              enabled: true,
              bridgeUrl: bridgeUrl,
              allowFrom: [],
            },
          };
          saveConfig(updatedConfig, configPath);
          console.log('\n✅ WhatsApp configured');
        }
      }

      console.log('\n' + '─'.repeat(40));
      console.log(`\n📁 Config saved to: ${configPath}`);
      console.log('\nNext: xopcbot agent -m "Hello!"');
    });

  return cmd;
}

// 自注册到命令注册表（与 onboard 功能类似，但保持独立以向后兼容）
register({
  id: 'configure',
  name: 'configure',
  description: 'Configure xopcbot interactively',
  factory: createConfigureCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopcbot configure',
      'xopcbot configure --provider',
    ],
  },
});
