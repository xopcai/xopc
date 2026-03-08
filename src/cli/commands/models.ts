import { Command } from 'commander';
import { loadConfig } from '../../config/index.js';
import { register, formatExamples } from '../registry.js';
import type { CLIContext } from '../registry.js';
import { getContextWithOpts } from '../index.js';
import { 
  getAllModels, 
  getAvailableModels, 
  getConfiguredProviders,
  isProviderConfigured 
} from '../../providers/index.js';

function createModelsCommand(_ctx: CLIContext): Command {
  const cmd = new Command('models')
    .description('List and manage available models')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot models list              # List all available models',
        'xopcbot models list --all        # Show all built-in models',
        'xopcbot models list --json       # Output as JSON',
      ])
    )
    .option('--json', 'Output as JSON', false)
    .option('--all, -a', 'Show all built-in models', false)
    .action(async (options) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const configuredProviders = getConfiguredProviders(config);

      if (options.json) {
        const models = options.all 
          ? getAllModels() 
          : getAvailableModels(config);
        console.log(JSON.stringify({
          providers: configuredProviders,
          models: models.map(m => ({
            id: `${m.provider}/${m.id}`,
            name: m.name,
            provider: m.provider,
          })),
        }, null, 2));
        return;
      }

      console.log('\n🤖 Available Models\n');
      console.log('═'.repeat(60));

      if (configuredProviders.length > 0) {
        console.log('\n📦 Configured Providers\n');
        for (const provider of configuredProviders) {
          console.log(`  ✓ ${provider}`);
        }
        console.log('');
      }

      const models = options.all 
        ? getAllModels() 
        : getAvailableModels(config);

      console.log('\n📚 Models\n');
      
      // Group by provider
      const byProvider = new Map<string, typeof models>();
      for (const model of models) {
        const list = byProvider.get(model.provider) ?? [];
        list.push(model);
        byProvider.set(model.provider, list);
      }

      for (const [provider, providerModels] of byProvider) {
        console.log(`  [${provider}]`);
        for (const model of providerModels) {
          const available = isProviderConfigured(config, provider);
          const status = available ? '✓' : '○';
          console.log(`    ${status} ${model.name}`);
        }
      }
      console.log('');

      console.log('═'.repeat(60));
      console.log(`\n📌 Current default model: ${config.agents?.defaults?.model || 'Not set'}`);

      console.log('\n📝 Usage:');
      console.log('   export OPENAI_API_KEY="sk-..."           # Set API key via env');
      console.log('   xopcbot agent -m "Hello"                # Use default model');
      console.log('   xopcbot agent -m "Hello" --model qwen/qwen-plus  # Specify model');
    });

  return cmd;
}

register({
  id: 'models',
  name: 'models',
  description: 'List and manage available models',
  factory: createModelsCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopcbot models list',
      'xopcbot models list --all',
    ],
  },
});
