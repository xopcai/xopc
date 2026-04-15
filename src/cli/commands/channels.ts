import { Command } from 'commander';

import { resolveConfigPath } from '../../config/paths.js';
import {
  getChannelPlugin,
  listChannelPlugins,
  syncChannelPluginsFromManager,
} from '../../channels/plugins/registry.js';
import { bundledChannelPlugins } from '../../generated/bundled-channel-plugins.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

function ensureChannelRegistryForCli(): void {
  if (listChannelPlugins().length === 0) {
    syncChannelPluginsFromManager(bundledChannelPlugins);
  }
}

function resolveConfigPathFromCommand(command: Command): string {
  const root =
    command.parent?.parent && command.parent.parent instanceof Command
      ? command.parent.parent
      : command.parent && command.parent instanceof Command
        ? command.parent
        : null;
  const globalOpts = (root && typeof root.opts === 'function'
    ? (root.opts() as { config?: string })
    : {}) as { config?: string };
  return (
    globalOpts.config?.trim() ||
    process.env.XOPC_CONFIG_PATH?.trim() ||
    process.env.XOPC_CONFIG?.trim() ||
    resolveConfigPath()
  );
}

function createChannelsCommand(ctx: CLIContext): Command {
  const cmd = new Command('channels')
    .description('Messaging channel login and credentials')
    .addHelpText(
      'after',
      formatExamples([
        'xopc channels login',
        'xopc channels login --channel weixin',
        'xopc channels login --account my-bot-id',
      ]),
    );

  cmd
    .command('login')
    .description('Log in with QR code or channel-specific credentials flow')
    .option('--channel <id>', 'Channel id', 'weixin')
    .option('--account <id>', 'Optional account id when re-logging an existing bot')
    .option('--timeout <ms>', 'Max wait for scan (default 480000)', '480000')
    .option('--credentials-only', 'Only save token files; do not update xopc.json')
    .action(async (options, command) => {
      ensureChannelRegistryForCli();
      const channelId = String(options.channel || '').trim() || 'weixin';
      const plugin = getChannelPlugin(channelId);
      if (!plugin?.cliLogin) {
        console.error(`Channel "${channelId}" does not support CLI login.`);
        const capable = listChannelPlugins()
          .filter((p) => p.cliLogin)
          .map((p) => p.id);
        if (capable.length > 0) {
          console.error(`Channels with login support: ${capable.join(', ')}`);
        }
        process.exitCode = 1;
        return;
      }

      const configPath = resolveConfigPathFromCommand(command);
      const timeoutMs = Math.max(60_000, Number.parseInt(String(options.timeout), 10) || 480_000);
      const verbose = ctx.isVerbose;

      const result = await plugin.cliLogin.runLogin({
        configPath,
        verbose,
        timeoutMs,
        accountId: options.account?.trim() || undefined,
        writeConfig: !options.credentialsOnly,
      });

      if (!result.ok) {
        console.error(result.message || 'Login failed');
        process.exitCode = 1;
      }
    });

  return cmd;
}

register({
  id: 'channels',
  name: 'channels',
  description: 'Messaging channel login',
  factory: createChannelsCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc channels login',
      'xopc channels login --account my-account-id',
    ],
  },
});
