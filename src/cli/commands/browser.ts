import { Command } from 'commander';

import { register, type CLIContext } from '../registry.js';

function createBrowserCommand(_ctx: CLIContext): Command {
  const command = new Command('browser').description('Browser Control v2 diagnostics and extension setup');
  command.command('doctor').description('Check the configured browser driver').action(async () => {
    const { doctorCli } = await import('./browser-cli-helpers.js');
    await doctorCli();
  });

  const extension = command.command('extension').description('Chrome extension setup');
  extension.command('doctor').description('Check extension artifacts').action(async () => {
    const { browserExtDoctor } = await import('../../browser/providers/browser-ext-install.js');
    console.log(JSON.stringify(await browserExtDoctor(), null, 2));
  });
  extension.command('install').description('Install extension artifacts').action(async () => {
    const { ensureBrowserExtensionArtifacts } = await import('../../browser/providers/browser-ext-install.js');
    console.log(JSON.stringify(await ensureBrowserExtensionArtifacts(), null, 2));
  });
  return command;
}

register({
  id: 'browser',
  name: 'browser',
  description: 'Browser Control v2 diagnostics and extension setup',
  factory: createBrowserCommand,
  metadata: { category: 'utility' },
});
