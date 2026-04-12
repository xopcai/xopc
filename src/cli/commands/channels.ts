import { Command } from 'commander';

import { resolveConfigPath } from '../../config/paths.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

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
    .description('Log in with QR code (Weixin / WeChat ilink)')
    .option('--channel <id>', 'Channel id', 'weixin')
    .option('--account <id>', 'Optional account id when re-logging an existing bot')
    .option('--timeout <ms>', 'Max wait for scan (default 480000)', '480000')
    .option('--credentials-only', 'Only save token files; do not update xopc.json')
    .action(async (options, command) => {
      if (options.channel !== 'weixin') {
        console.error(`Only --channel weixin is supported (got "${options.channel}").`);
        process.exitCode = 1;
        return;
      }

      const configPath = resolveConfigPathFromCommand(command);
      const timeoutMs = Math.max(60_000, Number.parseInt(String(options.timeout), 10) || 480_000);
      const verbose = ctx.isVerbose;

      const { runWeixinQrLoginCli } = await import('../../channels/weixin/index.js');

      const result = await runWeixinQrLoginCli({
        configPath,
        verbose,
        timeoutMs,
        account: options.account?.trim() || undefined,
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
