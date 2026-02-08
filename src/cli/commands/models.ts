import { Command } from 'commander';
import { loadConfig, listBuiltinModels, PROVIDER_NAMES, listConfiguredProviders } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

const log = createLogger('ModelsCommand');

function groupModelsByProvider(models: Array<{ id: string; name: string; provider: string }>) {
  const groups: Record<string, Array<{ id: string; name: string }>> = {};
  
  for (const model of models) {
    if (!groups[model.provider]) {
      groups[model.provider] = [];
    }
    groups[model.provider].push({ id: model.id.split('/')[1] || model.id, name: model.name });
  }
  
  return groups;
}

function createModelsCommand(ctx: CLIContext): Command {
  const cmd = new Command('models')
    .description('List and manage available models')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot models list              # List all models',
        'xopcbot models list --builtin    # Show built-in models',
        'xopcbot models list --json       # Output as JSON',
      ])
    )
    .option('--json', 'Output as JSON', false)
    .option('--builtin', 'Show built-in models only', false)
    .action(async (options) => {
      const config = loadConfig();
      const builtinModels = listBuiltinModels();
      const configuredProviders = listConfiguredProviders(config);
      
      if (options.json) {
        console.log(JSON.stringify({
          builtin: builtinModels,
          configured: configuredProviders,
        }, null, 2));
        return;
      }
      
      console.log('\n🤖 Available Models\n');
      console.log('═'.repeat(60));
      
      // Show configured providers
      if (configuredProviders.length > 0) {
        console.log('\n📦 Configured Providers\n');
        for (const provider of configuredProviders) {
          console.log(`  ✓ ${PROVIDER_NAMES[provider] || provider}`);
        }
        console.log('');
      }
      
      // Show built-in models
      if (!options.builtin || configuredProviders.length === 0) {
        console.log('\n📚 Built-in Models\n');
        const groups = groupModelsByProvider(builtinModels);
        for (const [provider, models] of Object.entries(groups)) {
          console.log(`  [${PROVIDER_NAMES[provider] || provider}]`);
          for (const model of models) {
            console.log(`    • ${model.name}`);
          }
        }
        console.log('');
      }
      
      console.log('═'.repeat(60));
      console.log(`\n📌 Current default model: ${config.agents?.defaults?.model || 'Not set'}`);
      
      console.log('\n📝 Usage:');
      console.log('   export OPENAI_API_KEY="sk-..."           # Set API key via env');
      console.log('   xopcbot agent -m "Hello"                # Use default model');
      console.log('   xopcbot agent -m "Hello" --model qwen/qwen-plus  # Specify model');
    });

  return cmd;
}

// 自注册到命令注册表
register({
  id: 'models',
  name: 'models',
  description: 'List and manage available models',
  factory: createModelsCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopcbot models list',
      'xopcbot models list --builtin',
    ],
  },
});
