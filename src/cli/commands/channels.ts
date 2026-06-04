import { Command } from 'commander';

import { approveChannelPairingFromCli, type PairingCliChannel } from '../../channels/pairing/index.js';
import { resolveConfigPath } from '../../config/paths.js';
import {
  getChannelPlugin,
  listChannelPlugins,
  syncChannelPluginsFromManager,
} from '../../channels/plugins/registry.js';
import { bundledChannelPlugins } from '../../generated/bundled-channel-plugins.js';
import { loadConfig } from '../../config/loader.js';
import type { Config } from '../../config/schema.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';

import {
  SETUP_EXIT,
  SetupValidationError,
  emitOutcome,
  isPromptCancelled,
  promptSecret,
  runSetup,
  type SetupOutcome,
} from './setup-shared/index.js';

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

  const PAIRING_CHANNELS = new Set<PairingCliChannel>(['telegram', 'feishu', 'weixin']);

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
    .command('list')
    .description('List configured channels and their account status')
    .option('--json', 'Output as JSON for agents/UIs', false)
    .action((opts: { json?: boolean }) => {
      ensureChannelRegistryForCli();
      const cfg = loadConfig(resolveConfigPathFromCommand(cmd));
      const channelsCfg = (cfg.channels ?? {}) as Record<string, Record<string, unknown>>;
      const entries = listChannelPlugins().map((plugin) => {
        const raw = channelsCfg[plugin.id] ?? {};
        const enabled = raw.enabled === true;
        const accounts = (raw.accounts ?? {}) as Record<string, Record<string, unknown>>;
        const accountSummaries = Object.entries(accounts).map(([id, acct]) => ({
          accountId: id,
          enabled: acct.enabled !== false,
          configured: typeof acct.botToken === 'string'
            ? Boolean((acct.botToken as string).trim())
            : false,
        }));
        return {
          id: plugin.id,
          name: plugin.meta?.label ?? plugin.id,
          enabled,
          hasLogin: Boolean(plugin.cliLogin),
          accountCount: accountSummaries.length,
          accounts: accountSummaries,
        };
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: true, channels: entries }) + '\n');
        return;
      }
      console.log('');
      console.log(colors.bold('CHANNELS'));
      const idWidth = Math.max(...entries.map((e) => e.id.length));
      for (const e of entries) {
        const status = e.enabled
          ? colors.green('● enabled')
          : colors.gray('○ disabled');
        const accts = e.accountCount > 0 ? colors.gray(` (${e.accountCount} accounts)`) : '';
        console.log(`  ${e.id.padEnd(idWidth)}  ${status}  ${colors.gray(e.name)}${accts}`);
      }
      console.log('');
      console.log(colors.gray('Use: xopc channels add <id> [--token <token>]'));
    });

  cmd
    .command('add <channel>')
    .description('Add or update a channel account (currently: telegram)')
    .option('--token <value>', 'Bot token (Telegram). Prompts securely if omitted.')
    .option('--account <id>', 'Account id (default: "default")')
    .option('--enable', 'Enable the channel after writing (default: true)', true)
    .option('--dry-run', 'Show the change without writing', false)
    .option('--json', 'Emit a single JSON outcome line', false)
    .action(
      async (
        channel: string,
        opts: {
          token?: string;
          account?: string;
          enable?: boolean;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        const channelId = channel.trim().toLowerCase();
        const accountId = opts.account?.trim() || 'default';
        const dryRun = Boolean(opts.dryRun);
        const json = Boolean(opts.json);

        if (channelId === 'feishu' || channelId === 'weixin') {
          const outcome: SetupOutcome = {
            ok: false,
            action: 'add',
            domain: `channels.${channelId}`,
            target: accountId,
            changedPaths: [],
            dryRun,
            errors: [
              {
                message:
                  channelId === 'weixin'
                    ? 'Weixin uses interactive QR login. Run: xopc channels login --channel weixin'
                    : 'Feishu add via CLI is not yet implemented. Edit `~/.xopc/xopc.json` (channels.feishu) or run: xopc onboard --channels',
              },
            ],
          };
          emitOutcome(outcome, json);
          process.exitCode = SETUP_EXIT.ERROR;
          return;
        }

        if (channelId !== 'telegram') {
          const outcome: SetupOutcome = {
            ok: false,
            action: 'add',
            domain: `channels.${channelId}`,
            target: accountId,
            changedPaths: [],
            dryRun,
            errors: [{ message: `Unknown channel "${channelId}". Try: xopc channels list` }],
          };
          emitOutcome(outcome, json);
          process.exitCode = SETUP_EXIT.ERROR;
          return;
        }

        let token = opts.token?.trim();
        if (!token) {
          token = process.env.TELEGRAM_BOT_TOKEN?.trim();
        }
        if (!token) {
          try {
            token = await promptSecret('Telegram bot token (from @BotFather):');
          } catch (error) {
            if (isPromptCancelled(error)) {
              const outcome: SetupOutcome = {
                ok: false,
                action: 'add',
                domain: 'channels.telegram',
                target: accountId,
                changedPaths: [],
                dryRun,
                errors: [{ message: 'Cancelled by user' }],
              };
              emitOutcome(outcome, json);
              process.exitCode = SETUP_EXIT.CANCELLED;
              return;
            }
            throw error;
          }
        }

        if (!validateTelegramToken(token)) {
          const outcome: SetupOutcome = {
            ok: false,
            action: 'add',
            domain: 'channels.telegram',
            target: accountId,
            changedPaths: [],
            dryRun,
            errors: [{ path: 'token', message: 'Token does not look like a Telegram bot token (expected `<digits>:<35+ chars>`).' }],
          };
          emitOutcome(outcome, json);
          process.exitCode = SETUP_EXIT.ERROR;
          return;
        }

        await runSetup({
          configPath: resolveConfigPathFromCommand(cmd),
          options: { dryRun, json },
          mutator: {
            domain: 'channels.telegram',
            target: accountId,
            action: 'add',
            mutate(config) {
              return applyTelegramAccount(config, accountId, token!, opts.enable !== false);
            },
            resultValue: () => ({
              channel: 'telegram',
              accountId,
              tokenMask: maskToken(token!),
            }),
            notes: () => [
              opts.enable !== false
                ? 'Telegram channel enabled. Restart the gateway for the new bot to come online.'
                : 'Telegram credentials saved (channel disabled). Use `--enable` to start it.',
            ],
          },
        });
      },
    );

  cmd
    .command('remove <channel>')
    .description('Remove a channel account')
    .option('--account <id>', 'Account id (default: "default")')
    .option('--dry-run', 'Show the change without writing', false)
    .option('--json', 'Emit a single JSON outcome line', false)
    .action(
      async (
        channel: string,
        opts: { account?: string; dryRun?: boolean; json?: boolean },
      ) => {
        const channelId = channel.trim().toLowerCase();
        const accountId = opts.account?.trim() || 'default';
        const dryRun = Boolean(opts.dryRun);
        const json = Boolean(opts.json);

        await runSetup({
          configPath: resolveConfigPathFromCommand(cmd),
          options: { dryRun, json },
          mutator: {
            domain: `channels.${channelId}`,
            target: accountId,
            action: 'remove',
            mutate(config) {
              return removeChannelAccount(config, channelId, accountId);
            },
          },
        });
      },
    );

  cmd
    .command('schema [channel]')
    .description('Print credential schemas for channels (for agents / UIs)')
    .option('--json', 'JSON output (default human-readable JSON)', false)
    .action((channel: string | undefined, opts: { json?: boolean }) => {
      ensureChannelRegistryForCli();
      const all = listChannelPlugins().map((p) => ({
        id: p.id,
        name: p.meta?.label ?? p.id,
        hasLogin: Boolean(p.cliLogin),
        configSchema: p.configSchema?.schema,
      }));
      const payload = {
        ok: true,
        channels: channel ? all.filter((c) => c.id === channel) : all,
      };
      if (opts.json) {
        process.stdout.write(JSON.stringify(payload) + '\n');
      } else {
        console.log(JSON.stringify(payload, null, 2));
      }
    });

  cmd
    .command('pairing')
    .description('Approve DM pairing requests (updates channel allowFrom credential files)')
    .addCommand(
      new Command('approve')
        .description('Approve a pairing code shown to the user in Telegram / Feishu / Weixin DMs')
        .requiredOption('--channel <id>', 'telegram | feishu | weixin')
        .option('--account <id>', 'Bot account id from config', 'default')
        .argument('<code>', 'Pairing code from the user message')
        .action((code: string, options: { channel?: string; account?: string }) => {
          const ch = (options.channel ?? '').trim().toLowerCase() as PairingCliChannel;
          if (!PAIRING_CHANNELS.has(ch)) {
            console.error('Invalid --channel. Use: telegram, feishu, or weixin.');
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

// ---------- helpers ----------

const TELEGRAM_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

export function validateTelegramToken(token: string): boolean {
  return TELEGRAM_TOKEN_PATTERN.test(token.trim());
}

export function maskToken(token: string): string {
  const t = token.trim();
  if (t.length <= 8) return '*'.repeat(t.length);
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export function applyTelegramAccount(
  cfg: Config,
  accountId: string,
  botToken: string,
  enable: boolean,
): Config {
  const channels = { ...((cfg.channels ?? {}) as Record<string, unknown>) };
  const tg = { ...((channels.telegram ?? {}) as Record<string, unknown>) };
  if (enable) tg.enabled = true;
  const accounts = { ...((tg.accounts ?? {}) as Record<string, Record<string, unknown>>) };
  accounts[accountId] = {
    ...(accounts[accountId] ?? {}),
    accountId,
    enabled: true,
    botToken,
  };
  tg.accounts = accounts;
  channels.telegram = tg;
  return { ...cfg, channels } as Config;
}

export function removeChannelAccount(
  cfg: Config,
  channelId: string,
  accountId: string,
): Config {
  if (channelId === 'feishu' || channelId === 'weixin' || channelId === 'telegram') {
    const channels = { ...((cfg.channels ?? {}) as Record<string, unknown>) };
    const ch = { ...((channels[channelId] ?? {}) as Record<string, unknown>) };
    const accounts = { ...((ch.accounts ?? {}) as Record<string, unknown>) };
    if (!(accountId in accounts)) {
      throw new SetupValidationError([
        { message: `No account "${accountId}" on channel "${channelId}".` },
      ]);
    }
    delete accounts[accountId];
    ch.accounts = accounts;
    if (Object.keys(accounts).length === 0) {
      ch.enabled = false;
    }
    channels[channelId] = ch;
    return { ...cfg, channels } as Config;
  }
  throw new SetupValidationError([
    { message: `Unknown channel "${channelId}". Try: xopc channels list` },
  ]);
}

register({
  id: 'channels',
  name: 'channels',
  description: 'Messaging channel login',
  factory: createChannelsCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc channels list',
      'xopc channels add telegram --token 123456:ABC...',
      'xopc channels remove telegram',
      'xopc channels login',
      'xopc channels pairing approve --channel feishu --account default ABC12XYZ',
    ],
  },
});
