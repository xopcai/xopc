import { Command } from 'commander';
import { loadConfig } from '../../config/index.js';
import { getAvailableModels } from '../../providers/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ModelsCommand');

export function createModelsCommand(): Command {
  const cmd = new Command('models')
    .description('List and manage available models')
    .addHelpText(
      'after',
      `
Examples:
  $ xopcbot models list              # List all configured models
  $ xopcbot models list --json       # Output as JSON
`
    )
    .option('--json', 'Output as JSON', false)
    .action(async (options) => {
      const config = loadConfig();
      const models = getAvailableModels(config);
      
      if (options.json) {
        console.log(JSON.stringify(models, null, 2));
        return;
      }
      
      console.log('\n📋 Available Models\n');
      console.log('─'.repeat(50));
      
      if (models.length === 0) {
        console.log('\nNo custom models configured.');
        console.log('\nUsing built-in models from pi-ai library.');
        console.log('\nTo add custom models, edit ~/.xopcbot/config.json:');
        console.log(`
{
  "models": {
    "providers": {
      "my-provider": {
        "baseUrl": "https://api.example.com/v1",
        "apiKey": "sk-...",
        "apiType": "openai",
        "models": [
          { "id": "my-model", "name": "My Model" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": "my-provider/my-model"
    }
  }
}
`);
      } else {
        for (const model of models) {
          console.log(`\n🤖 ${model.name}`);
          console.log(`   ID: ${model.id}`);
          console.log(`   Provider: ${model.provider}`);
        }
      }
      
      console.log('\n' + '─'.repeat(50));
      console.log(`\n📌 Current default model: ${config.agents?.defaults?.model || 'Not set'}`);
    });

  return cmd;
}
