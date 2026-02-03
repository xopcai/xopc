import { Command } from 'commander';
import { input, confirm, select, password } from '@inquirer/prompts';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, saveConfig, ConfigSchema } from '../../config/index.js';

// Available providers for selection
const PROVIDERS = [
  { name: 'OpenAI', value: 'openai', models: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'openai/gpt-5.2'] },
  { name: 'Anthropic', value: 'anthropic', models: ['anthropic/claude-opus-4-5', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-haiku-4-5'] },
  { name: 'Google Gemini', value: 'gemini', models: ['google/gemini-2.5-pro', 'google/gemini-2.5-flash'] },
  { name: 'DeepSeek', value: 'deepseek', models: ['deepseek/deepseek-chat', 'deepseek/deepseek-r1'] },
  { name: 'OpenRouter', value: 'openrouter', models: ['anthropic/claude-opus-4-5', 'openai/gpt-4o', 'google/gemini-2.5-pro'] },
  { name: 'Groq', value: 'groq', models: ['groq/llama-3.3-70b-versatile', 'groq/llama-3.1-70b-instruct'] },
  { name: 'MiniMax', value: 'minimax', models: ['minimax/minimax-m2.1', 'minimax/minimax-m2'] },
  { name: 'Qwen', value: 'qwen', models: ['qwen/qwen-plus', 'qwen/qwen3-235b-a22b'] },
  { name: 'Kimi', value: 'kimi', models: ['moonshotai/kimi-k2.5', 'moonshotai/kimi-k2-thinking'] },
  { name: 'GLM (智谱)', value: 'zhipu', models: ['z-ai/glm-4.7', 'z-ai/glm-4.6'] },
];

export function createConfigureCommand(): Command {
  const cmd = new Command('configure')
    .description('Configure xopcbot interactively')
    .addHelpText(
      'after',
      `\nExamples:
  $ xopcbot configure                    # Interactive wizard
  $ xopcbot configure --provider        # Configure LLM provider only
  $ xopcbot configure --channel        # Configure channels only
`
    )
    .option('--provider', 'Configure LLM provider')
    .option('--channel', 'Configure channels')
    .option('--all', 'Configure everything (provider + channels)')
    .action(async (opts) => {
      const configPath = join(homedir(), '.xopcbot', 'config.json');
      const existingConfig = existsSync(configPath)
        ? loadConfig(configPath)
        : ConfigSchema.parse({});

      const doProvider = opts.provider || opts.all;
      const doChannel = opts.channel || opts.all;
      
      // If no options specified, run full wizard
      const runFullWizard = !doProvider && !doChannel;

      console.log('\n🧙 xopcbot Configuration Wizard\n');
      console.log('─'.repeat(40));

      // Step 1: Provider Configuration
      if (runFullWizard || doProvider) {
        console.log('\n📦 Step 1: LLM Provider Configuration\n');
        
        const hasExistingProviders = Object.keys(existingConfig.providers || {}).length > 0;
        
        if (hasExistingProviders && !runFullWizard) {
          console.log('⚠️  Provider config already exists. Updating...\n');
        }

        const provider = await select({
          message: 'Select your LLM provider:',
          choices: [
            ...PROVIDERS.map(p => ({ value: p.value, name: p.name })),
            { value: 'skip', name: 'Skip (configure later)' },
          ],
        });

        if (provider !== 'skip') {
          const providerInfo = PROVIDERS.find(p => p.value === provider)!;
          
          console.log(`\nYou selected: ${providerInfo.name}`);
          console.log(`Available models: ${providerInfo.models.join(', ')}\n`);

          const apiKey = await password({
            message: `Enter your ${providerInfo.name} API key:`,
            validate: (value: string) => value.length > 0 || 'API key is required',
          });

          // Handle different provider configurations
          const updatedConfig = { ...existingConfig };
          
          switch (provider) {
            case 'openai':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                openai: { api_key: apiKey },
              };
              break;
            case 'anthropic':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                anthropic: { api_key: apiKey },
              };
              break;
            case 'gemini':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                gemini: { api_key: apiKey },
              };
              break;
            case 'deepseek':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                openrouter: { 
                  api_key: apiKey,
                  api_base: 'https://api.deepseek.com/v1',
                },
              };
              break;
            case 'openrouter':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                openrouter: { 
                  api_key: apiKey,
                  api_base: 'https://openrouter.ai/api/v1',
                },
              };
              break;
            case 'groq':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                groq: { api_key: apiKey },
              };
              break;
            case 'minimax':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                openrouter: { 
                  api_key: apiKey,
                  api_base: 'https://api.minimax.chat/v1',
                },
              };
              break;
            case 'qwen':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                openrouter: { 
                  api_key: apiKey,
                  api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                },
              };
              break;
            case 'kimi':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                openrouter: { 
                  api_key: apiKey,
                  api_base: 'https://api.moonshot.cn/v1',
                },
              };
              break;
            case 'zhipu':
              updatedConfig.providers = {
                ...updatedConfig.providers,
                zhipu: { api_key: apiKey },
              };
              break;
          }

          // Select model
          const model = await select({
            message: 'Select default model:',
            choices: providerInfo.models.map(m => ({ value: m, name: m })),
          });

          updatedConfig.agents = {
            ...updatedConfig.agents,
            defaults: {
              ...updatedConfig.agents?.defaults,
              model,
            },
          };

          // Save config
          const finalConfig = ConfigSchema.parse(updatedConfig);
          saveConfig(finalConfig, configPath);
          console.log(`\n✅ Provider configured: ${providerInfo.name}`);
          console.log(`   Model: ${model}`);
        }
      }

      // Step 2: Channel Configuration
      if (runFullWizard || doChannel) {
        console.log('\n💬 Step 2: Channels Configuration\n');

        const enableTelegram = await confirm({
          message: 'Enable Telegram?',
          default: existingConfig.channels?.telegram?.enabled || false,
        });

        if (enableTelegram) {
          const token = await password({
            message: 'Enter Telegram Bot Token:',
            validate: (value: string) => value.length > 0 || 'Token is required',
          });

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
              allow_from: allowFrom
                ? allowFrom.split(',').map((s: string) => s.trim())
                : [],
            },
          };

          const finalConfig = ConfigSchema.parse(updatedConfig);
          saveConfig(finalConfig, configPath);
          console.log('\n✅ Telegram configured');
        }

        const enableWhatsApp = await confirm({
          message: 'Enable WhatsApp?',
          default: existingConfig.channels?.whatsapp?.enabled || false,
        });

        if (enableWhatsApp) {
          const bridgeUrl = await input({
            message: 'WhatsApp Bridge URL:',
            default: existingConfig.channels?.whatsapp?.bridge_url || 'ws://localhost:3001',
          });

          const allowFrom = await input({
            message: 'Allowed numbers (comma-separated, leave empty for all):',
            default: '',
          });

          const updatedConfig = existsSync(configPath) ? loadConfig(configPath) : ConfigSchema.parse({});
          updatedConfig.channels = {
            ...updatedConfig.channels,
            whatsapp: {
              enabled: true,
              bridge_url: bridgeUrl,
              allow_from: allowFrom
                ? allowFrom.split(',').map((s: string) => s.trim())
                : [],
            },
          };

          const finalConfig = ConfigSchema.parse(updatedConfig);
          saveConfig(finalConfig, configPath);
          console.log('\n✅ WhatsApp configured');
        }
      }

      console.log('\n' + '─'.repeat(40));
      console.log('\n🎉 Configuration complete!');
      console.log(`\n📁 Config saved to: ${configPath}`);
      console.log('\nNext steps:');
      console.log('  • Run: xopcbot agent -m "Hello!"');
      console.log('  • Edit config: xopcbot config get agents.defaults.model');
      console.log('  • Full docs: See docs/configuration.md');
    });

  return cmd;
}
