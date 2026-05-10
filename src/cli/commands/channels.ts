import { Command } from 'commander';

import { approveChannelPairingFromCli, type PairingCliChannel } from '../../channels/pairing/index.js';
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
        'xopc channels login --channel feishu',
        'xopc channels login --account my-bot-id',
        'xopc channels pairing approve --channel telegram ABC12XYZ',
      ]),
    );

  const PAIRING_CHANNELS = new Set<PairingCliChannel>(['telegram', 'feishu', 'dingtalk', 'weixin']);

  cmd
    .command('login')
    .description('Log in with QR code or channel-specific credentials flow')
    .option(
      '--channel <id>',
      'Channel id (auto-detected when only one login-capable channel is registered)',
    )
    .option('--account <id>', 'Optional account id when re-logging an existing bot')
    .option('--timeout <ms>', 'Max wait for scan (default 480000)', '480000')
    .option('--credentials-only', 'Only save token files; do not update xopc.json')
    .action(async (options, command) => {
      ensureChannelRegistryForCli();
      const explicitChannel = options.channel?.trim?.();
      let channelId: string;
      if (explicitChannel) {
        channelId = explicitChannel;
      } else {
        const loginCapable = listChannelPlugins().filter((p) => p.cliLogin);
        if (loginCapable.length === 1) {
          channelId = loginCapable[0].id;
          console.log(`Auto-detected channel: ${channelId}`);
        } else if (loginCapable.length === 0) {
          console.error('No channels with login support found.');
          process.exitCode = 1;
          return;
        } else {
          console.error(
            `Multiple channels support login: ${loginCapable.map((p) => p.id).join(', ')}. ` +
              'Use --channel <id> to specify.',
          );
          process.exitCode = 1;
          return;
        }
      }
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
        if (result.cancelled) {
          process.exitCode = 130;
          return;
        }
        console.error(result.message || 'Login failed');
        process.exitCode = 1;
      }
    });

  cmd
    .command('pairing')
    .description('Approve DM pairing requests (updates channel allowFrom credential files)')
    .addCommand(
      new Command('approve')
        .description('Approve a pairing code shown to the user in Telegram / Feishu / DingTalk / Weixin DMs')
        .requiredOption('--channel <id>', 'telegram | feishu | dingtalk | weixin')
        .option('--account <id>', 'Bot account id from config', 'default')
        .argument('<code>', 'Pairing code from the user message')
        .action((code: string, options: { channel?: string; account?: string }) => {
          const ch = (options.channel ?? '').trim().toLowerCase() as PairingCliChannel;
          if (!PAIRING_CHANNELS.has(ch)) {
            console.error('Invalid --channel. Use: telegram, feishu, dingtalk, or weixin.');
            process.exitCode = 1;
            return;
          }
          const accountId = (options.account ?? 'default').trim() || 'default';
          const result = approveChannelPairingFromCli({
            channel: ch,
            accountId,
            code: String(code ?? '').trim(),
          });
          if (result.ok === false) {
            console.error(result.error);
            process.exitCode = 1;
            return;
          }
          console.log(`Approved. Sender id added to allowFrom store: ${result.senderId}`);
        }),
    );

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
      'xopc channels pairing approve --channel feishu --account default ABC12XYZ',
    ],
  },
});
