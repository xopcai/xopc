import { Command } from 'commander';
import { input, confirm, select } from '@inquirer/prompts';
import { existsSync } from 'fs';
import { loadConfig, saveConfig, ConfigSchema } from '../../config/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { ModelRegistry } from '../../providers/index.js';
import { colors } from '../utils/colors.js';

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
      let config = existsSync(configPath)
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

        // Use ModelRegistry to get provider info
        const providerInfos = ModelRegistry.getAllProviderInfo();
        const registry = new ModelRegistry();

        // Filter to common providers
        const commonProviders = ['openai', 'anthropic', 'google', 'qwen', 'kimi', 'deepseek', 'groq', 'moonshot', 'minimax', 'minimax-cn', 'openrouter', 'xai'];
        const availableProviders = providerInfos.filter(p => commonProviders.includes(p.id));

        const choices = availableProviders.map(p => ({
          value: p.id,
          name: `${p.name} (${p.envKey || 'no env key'})`,
        }));

        const provider = await select({
          message: 'Select your LLM provider:',
          choices,
        });

        const providerInfo = providerInfos.find(p => p.id === provider)!;
        console.log(`\n📌 ${providerInfo.name}`);

        // Check if provider supports OAuth
        if (providerInfo.supportsOAuth) {
          console.log(`  ${colors.green('✓')} Supports OAuth login`);
          console.log(`    Use: xopcbot auth login ${provider}`);
        }

        const apiKey = await input({
          message: `Enter API key for ${providerInfo.name}:`,
          validate: (value: string) => value.length > 0 || 'API key is required',
        });

        // Load additional models from models-dev-data.ts
        await registry.loadModelsDevModels();

        // Get available models for this provider
        const models = registry.getAll().filter(m => m.provider === provider);
        const modelChoices = models.slice(0, 20).map(m => ({
          value: `${m.provider}/${m.id}`,
          name: `${m.name || m.id} ${m.reasoning ? '(reasoning)' : ''}`,
        }));

        if (modelChoices.length === 0) {
          console.log(`  ${colors.yellow('⚠')} No built-in models found for ${providerInfo.name}`);
          console.log(`    You can specify a custom model name later`);
        }

        const model = await select({
          message: 'Select model:',
          choices: modelChoices.length > 0 ? modelChoices : [
            { value: `${provider}/default`, name: 'Default model' }
          ],
        });

        // Build config based on provider type
        config.providers = config.providers || {};

        if (provider === 'anthropic' || provider === 'google') {
          // Native providers
          config.providers[provider] = { apiKey };
        } else {
          // OpenAI-compatible providers
          config.providers[provider] = {
            apiKey,
            baseUrl: providerInfo.baseUrl,
          };
        }

        config.agents = config.agents || {};
        config.agents.defaults = {
          ...config.agents.defaults,
          workspace: config.agents?.defaults?.workspace || '~/.xopcbot/workspace',
          maxTokens: config.agents?.defaults?.maxTokens || 8192,
          temperature: config.agents?.defaults?.temperature || 0.7,
          maxToolIterations: config.agents?.defaults?.maxToolIterations || 20,
          model,
        };

        console.log(`\n✅ ${providerInfo.name} configured`);
        console.log(`   Model: ${model}`);
        console.log(`   ${colors.gray('Tip: Use "xopcbot auth login ' + provider + '" for OAuth')}`);
      }

      if (runFullWizard || doChannel) {
        console.log('\n💬 Step 2: Channels\n');

        const enableTelegram = await confirm({
          message: 'Enable Telegram?',
          default: config.channels?.telegram?.enabled || false,
        });

        if (enableTelegram) {
          const token = await input({ message: 'Telegram Bot Token:' });
          const allowFrom = await input({
            message: 'Allowed user IDs (comma-separated, leave empty for all):',
            default: '',
          });

          config.channels = config.channels || {};
          // Merge with existing config to preserve apiRoot and other settings
          config.channels.telegram = {
            ...config.channels.telegram,
            enabled: true,
            token,
            allowFrom: allowFrom
              ? allowFrom.split(',').map((s: string) => s.trim())
              : [],
            debug: config.channels.telegram?.debug ?? false,
            dmPolicy: config.channels.telegram?.dmPolicy ?? 'pairing',
            groupPolicy: config.channels.telegram?.groupPolicy ?? 'open',
          };
          console.log('\n✅ Telegram configured');
        }

        const enableWhatsApp = await confirm({
          message: 'Enable WhatsApp?',
          default: config.channels?.whatsapp?.enabled || false,
        });

        if (enableWhatsApp) {
          const bridgeUrl = await input({
            message: 'WhatsApp Bridge URL:',
            default: 'ws://localhost:3001',
          });

          config.channels = config.channels || {};
          // Merge with existing config to preserve other settings
          config.channels.whatsapp = {
            ...config.channels.whatsapp,
            enabled: true,
            bridgeUrl,
            allowFrom: config.channels.whatsapp?.allowFrom ?? [],
          };
          console.log('\n✅ WhatsApp configured');
        }
      }

      // Save config once at the end
      const finalConfig = ConfigSchema.parse(config);
      await saveConfig(finalConfig, configPath);

      console.log('\n' + '─'.repeat(40));
      console.log(`\n📁 Config saved to: ${configPath}`);
      console.log('\nNext: xopcbot agent -m "Hello!"');
      console.log(`View auth: ${colors.cyan('xopcbot auth list')}`);
    });

  return cmd;
}

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
