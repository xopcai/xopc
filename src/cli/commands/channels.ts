import { Command } from 'commander';

import {
  approveChannelPairingFromCli,
  listChannelPairingState,
} from '../../channels/pairing/index.js';
import { buildChannelCatalogForConfig } from '../../channels/catalog/channel-catalog-service.js';
import { loadConfig, saveConfig } from '../../config/loader.js';
import type { Config } from '../../config/schema.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';

function normalizeChannelId(raw: string): string {
  return raw.trim().toLowerCase();
}

function loadCliConfig(ctx: CLIContext): Config {
  return loadConfig(ctx.configPath);
}

async function writeCliConfig(ctx: CLIContext, cfg: Config): Promise<void> {
  await saveConfig(cfg, ctx.configPath);
}

function ensureChannelObject(cfg: Config, channelId: string): Record<string, unknown> {
  if (!cfg.channels) cfg.channels = {};
  const channels = cfg.channels as Record<string, unknown>;
  const existing = channels[channelId];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  channels[channelId] = next;
  return next;
}

function assertCatalogChannel(cfg: Config, channelId: string): void {
  const catalog = buildChannelCatalogForConfig(cfg);
  if (!catalog.byId.has(channelId)) {
    throw new Error(`Unknown channel "${channelId}". Install or declare a channel extension contribution first.`);
  }
}

function createChannelsCommand(ctx: CLIContext): Command {
  const cmd = new Command('channels')
    .description('Messaging channel configuration')
    .addHelpText(
      'after',
      formatExamples([
        'xopc channels list',
        'xopc channels show telegram',
        'xopc channels enable telegram',
        'xopc channels config set-json telegram \'{"enabled":true}\'',
        'xopc channels pairing approve telegram ABC12XYZ',
      ]),
    );

  cmd
    .command('list')
    .description('List channel extension contributions')
    .option('--json', 'Output as JSON', false)
    .action((opts: { json?: boolean }) => {
      const cfg = loadCliConfig(ctx);
      const catalog = buildChannelCatalogForConfig(cfg);
      const channels = cfg.channels as Record<string, { enabled?: boolean } | undefined> | undefined;
      const rows = catalog.entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        extensionId: entry.extensionId,
        source: entry.source,
        enabled: channels?.[entry.id]?.enabled === true,
        configured: Boolean(channels?.[entry.id]),
      }));
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, channels: rows })}\n`);
        return;
      }
      console.log('');
      console.log(colors.bold('CHANNELS'));
      const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
      for (const row of rows) {
        const status = row.enabled ? colors.green('enabled') : colors.gray('disabled');
        console.log(`  ${row.id.padEnd(idWidth)}  ${status}  ${colors.gray(row.label)}  ${colors.gray(row.extensionId)}`);
      }
      console.log('');
    });

  cmd
    .command('show <channel>')
    .description('Show one channel catalog entry and config')
    .option('--json', 'Output as JSON', false)
    .action((channel: string, opts: { json?: boolean }) => {
      const cfg = loadCliConfig(ctx);
      const channelId = normalizeChannelId(channel);
      const catalog = buildChannelCatalogForConfig(cfg);
      const entry = catalog.byId.get(channelId);
      if (!entry) {
        console.error(`Unknown channel "${channelId}".`);
        process.exitCode = 1;
        return;
      }
      const config = (cfg.channels as Record<string, unknown> | undefined)?.[channelId] ?? {};
      const payload = { entry, config };
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, ...payload })}\n`);
        return;
      }
      console.log(JSON.stringify(payload, null, 2));
    });

  cmd
    .command('enable <channel>')
    .description('Enable a channel config block')
    .action(async (channel: string) => {
      const cfg = loadCliConfig(ctx);
      const channelId = normalizeChannelId(channel);
      assertCatalogChannel(cfg, channelId);
      ensureChannelObject(cfg, channelId).enabled = true;
      await writeCliConfig(ctx, cfg);
      console.log(`Enabled channel ${channelId}`);
    });

  cmd
    .command('disable <channel>')
    .description('Disable a channel config block')
    .action(async (channel: string) => {
      const cfg = loadCliConfig(ctx);
      const channelId = normalizeChannelId(channel);
      assertCatalogChannel(cfg, channelId);
      ensureChannelObject(cfg, channelId).enabled = false;
      await writeCliConfig(ctx, cfg);
      console.log(`Disabled channel ${channelId}`);
    });

  const config = cmd.command('config').description('Edit channel config');
  config
    .command('set-json <channel> <json>')
    .description('Merge a JSON object into channels.<id>')
    .action(async (channel: string, json: string) => {
      const cfg = loadCliConfig(ctx);
      const channelId = normalizeChannelId(channel);
      assertCatalogChannel(cfg, channelId);
      const patch = JSON.parse(json) as unknown;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('JSON value must be an object');
      }
      Object.assign(ensureChannelObject(cfg, channelId), patch);
      await writeCliConfig(ctx, cfg);
      console.log(`Updated channels.${channelId}`);
    });

  const pairing = cmd.command('pairing').description('Manage channel pairing state');
  pairing
    .command('list <channel>')
    .option('--account <id>', 'Account id', 'default')
    .option('--json', 'Output as JSON', false)
    .action((channel: string, opts: { account?: string; json?: boolean }) => {
      const cfg = loadCliConfig(ctx);
      const state = listChannelPairingState({
        channel: normalizeChannelId(channel),
        accountId: opts.account,
        config: cfg,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, state })}\n`);
        return;
      }
      console.log(JSON.stringify(state, null, 2));
    });
  pairing
    .command('approve <channel> <code>')
    .option('--account <id>', 'Account id', 'default')
    .action((channel: string, code: string, opts: { account?: string }) => {
      const result = approveChannelPairingFromCli({
        channel: normalizeChannelId(channel),
        accountId: opts.account ?? 'default',
        code,
      });
      if (result.ok === false) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      console.log(`Approved sender ${result.senderId}`);
    });

  return cmd;
}

register({
  id: 'channels',
  name: 'channels',
  description: 'Messaging channel configuration',
  factory: createChannelsCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc channels list',
      'xopc channels show telegram',
      'xopc channels enable telegram',
      'xopc channels config set-json telegram \'{"enabled":true}\'',
    ],
  },
});
