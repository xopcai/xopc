import { Command } from 'commander';

import { listImageGenerationProvidersSummary } from '../../agent/image/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

function createImageCommand(_ctx: CLIContext): Command {
  const cmd = new Command('image')
    .description('Inspect image provider availability')
    .addHelpText(
      'after',
      formatExamples([
        'xopc image providers   # List available image generation providers',
        'xopc image status      # Explain current manifest-era image behavior',
      ]),
    );

  cmd
    .command('status')
    .description('Show image runtime status')
    .action(() => {
      console.log('Image model defaults were removed.');
      console.log('Image generation now uses configured providers discovered at runtime.');
      console.log('Agent-specific capability policy belongs in agent manifests or capability presets.');
    });

  cmd
    .command('providers')
    .description('List image generation providers')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const providers = listImageGenerationProvidersSummary();
      if (opts.json) {
        console.log(JSON.stringify(providers, null, 2));
        return;
      }
      for (const provider of providers) {
        console.log(`${provider.id}: ${provider.defaultModel ?? provider.models[0] ?? 'no default model'}`);
      }
    });

  return cmd;
}

register({
  id: 'image',
  name: 'image',
  description: 'Inspect image provider availability',
  factory: createImageCommand,
  metadata: { category: 'utility' },
});
