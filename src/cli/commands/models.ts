import { Command } from 'commander';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { getContextWithOpts } from '../context.js';
import {
  getAllModels,
  getAvailableModels,
  getConfiguredProviders,
  isProviderConfigured,
} from '../../providers/index.js';
import { loadConfig } from '../../config/index.js';

type ModelsListOptions = {
  json?: boolean;
  all?: boolean;
};

async function runModelsList(options: ModelsListOptions): Promise<void> {
  const ctx = getContextWithOpts();
  const config = loadConfig(ctx.configPath);
  const configuredProviders = await getConfiguredProviders();

  if (options.json) {
    const models = options.all ? getAllModels() : await getAvailableModels();
    console.log(
      JSON.stringify(
        {
          providers: configuredProviders,
          models: models.map((m) => ({
            id: `${m.provider}/${m.id}`,
            name: m.name,
            provider: m.provider,
          })),
        },
        null,
        2,
      ),
    );
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

  const models = options.all ? getAllModels() : await getAvailableModels();

  console.log('\n📚 Models\n');

  const byProvider = new Map<string, ReturnType<typeof getAllModels>[number][]>();
  for (const model of models) {
    const list = byProvider.get(model.provider) ?? [];
    list.push(model);
    byProvider.set(model.provider, list);
  }

  const IMAGE_GENERATION_IDS = new Set([
    'gpt-image-1',
    'dall-e-3',
    'dall-e-2',
    'wan2.6-t2i',
    'wan2.7-image-pro',
    'wan2.7-image',
    'wan2.1-t2i-turbo',
    'wan2.1-t2i-plus',
    'image-01',
    'image-01-live',
  ]);
  const VISION_IDS = new Set([
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'claude-sonnet-4-5',
    'claude-haiku-3-5',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'qwen-vl-max',
    'qwen2.5-vl-72b-instruct',
  ]);

  for (const [provider, providerModels] of byProvider) {
    console.log(`  [${provider}]`);
    for (const model of providerModels) {
      const available = await isProviderConfigured(provider);
      const status = available ? '✓' : '○';
      const badges: string[] = [];
      if (IMAGE_GENERATION_IDS.has(model.id)) {
        badges.push('gen');
      }
      if (model.input?.includes('image') || VISION_IDS.has(model.id)) {
        badges.push('vision');
      }
      const badgeStr = badges.length > 0 ? ` [${badges.join(', ')}]` : '';
      console.log(`    ${status} ${model.name}${badgeStr}`);
    }
  }
  console.log('');

  console.log('═'.repeat(60));
  console.log(`\n📌 Current default model: ${config.agents?.defaults?.model || 'Not set'}`);

  console.log('\n📝 Usage:');
  console.log('   export OPENAI_API_KEY="sk-..."           # Set API key via env');
  console.log('   xopc agent -m "Hello"                # Use default model');
  console.log('   xopc agent -m "Hello" --model openai/gpt-4o  # Specify model');
}

function attachModelsListOptions(command: Command): Command {
  return command
    .option('--json', 'Output as JSON', false)
    .option('--all, -a', 'Show all built-in models', false);
}

function createModelsCommand(_ctx: CLIContext): Command {
  const cmd = new Command('models')
    .description('List and manage available models')
    .addHelpText(
      'after',
      formatExamples([
        'xopc models list              # List all available models',
        'xopc models list --all        # Show all built-in models',
        'xopc models list --json       # Output as JSON',
        'xopc models --all             # Same as models list --all',
      ]),
    );

  attachModelsListOptions(cmd).action(async (options) => {
    await runModelsList(options);
  });

  attachModelsListOptions(
    cmd.command('list').description('List available models'),
  ).action(async (options) => {
    await runModelsList(options);
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
      'xopc models list',
      'xopc models list --all',
    ],
  },
});

export { createModelsCommand };
