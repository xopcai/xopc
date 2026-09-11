import { Command } from 'commander';

import { register, type CLIContext } from '../registry.js';

function createBrowserCommand(ctx: CLIContext): Command {
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
    const {
      ensureBrowserExtensionArtifacts,
      installBrowserNativeMessagingHost,
    } = await import('../../browser/providers/browser-ext-install.js');
    const artifacts = await ensureBrowserExtensionArtifacts();
    const nativeHost = await installBrowserNativeMessagingHost({ configPath: ctx.configPath });
    console.log(JSON.stringify({ ...artifacts, nativeHost }, null, 2));
  });
  extension.command('native-host').description('Run the Chrome native messaging bootstrap host').action(async () => {
    process.env.XOPC_LOG_CONSOLE = 'false';
    const { runBrowserNativeMessagingHost } = await import('../../browser/native-messaging-host.js');
    await runBrowserNativeMessagingHost(ctx.configPath);
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
