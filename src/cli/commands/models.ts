import { Command } from 'commander';
import { loadConfig, listBuiltinModels } from '../../config/index.js';
import { getAvailableModels } from '../../providers/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ModelsCommand');

// Provider display names
const PROVIDER_NAMES: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google Gemini',
  'qwen': 'Qwen (通义千问)',
  'kimi': 'Kimi (月之暗面)',
  'moonshotai': 'Moonshot AI (国际)',
  'minimax': 'MiniMax',
  'deepseek': 'DeepSeek',
  'groq': 'Groq',
  'openrouter': 'OpenRouter',
};

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

export function createModelsCommand(): Command {
  const cmd = new Command('models')
    .description('List and manage available models')
    .addHelpText(
      'after',
      `
Examples:
  $ xopcbot models list              # List all available models
  $ xopcbot models list --json       # Output as JSON
  $ xopcbot models list --builtin    # Show built-in models only
  $ xopcbot models list --custom     # Show custom models only
`
    )
    .option('--json', 'Output as JSON', false)
    .option('--builtin', 'Show built-in models only', false)
    .option('--custom', 'Show custom models only', false)
    .action(async (options) => {
      const config = loadConfig();
      const customModels = getAvailableModels(config);
      const builtinModels = listBuiltinModels();
      
      let displayModels = customModels;
      let showBuiltin = !options.custom;
      let showCustom = !options.builtin;
      
      if (options.builtin) showBuiltin = true;
      if (options.custom) showCustom = true;
      
      if (options.json) {
        if (showBuiltin && showCustom) {
          console.log(JSON.stringify({ builtin: builtinModels, custom: customModels }, null, 2));
        } else if (showBuiltin) {
          console.log(JSON.stringify(builtinModels, null, 2));
        } else {
          console.log(JSON.stringify(customModels, null, 2));
        }
        return;
      }
      
      console.log('\n🤖 Available Models\n');
      console.log('═'.repeat(60));
      
      // Show custom models first if any
      if (showCustom && customModels.length > 0) {
        console.log('\n📦 Custom Models\n');
        const customGroups = groupModelsByProvider(customModels);
        for (const [provider, models] of Object.entries(customGroups)) {
          console.log(`\n  [${PROVIDER_NAMES[provider] || provider}]`);
          for (const model of models) {
            console.log(`    • ${model.name} (${model.id})`);
          }
        }
        console.log('');
      }
      
      // Show built-in models
      if (showBuiltin) {
        console.log('\n📚 Built-in Models\n');
        const builtinGroups = groupModelsByProvider(builtinModels);
        for (const [provider, models] of Object.entries(builtinGroups)) {
          console.log(`\n  [${PROVIDER_NAMES[provider] || provider}]`);
          for (const model of models) {
            console.log(`    • ${model.name}`);
          }
        }
        console.log('');
      }
      
      console.log('═'.repeat(60));
      console.log(`\n📌 Current default model: ${config.agents?.defaults?.model || 'Not set'}`);
      
      console.log('\n📝 Usage:');
      console.log('   xopcbot agent -m "Hello"              # Use default model');
      console.log('   xopcbot agent -m "Hello" --model qwen/qwen-plus  # Specify model');
    });

  return cmd;
}
